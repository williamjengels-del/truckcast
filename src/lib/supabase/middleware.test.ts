/**
 * Unit tests for the impersonation mutation block inside updateSession.
 *
 * The 2026-04-21 investigation brief flagged this as an open gap: the
 * crypto primitives in admin-impersonation.test.ts are covered, and
 * Playwright covers the live HTTP path, but the gate logic inside
 * updateSession was unreachable from CI without network + Supabase +
 * admin creds. These tests fill that gap by exercising updateSession
 * directly with a hand-constructed NextRequest carrying a valid signed
 * cookie.
 *
 * Scope: only the 403 paths — those return before updateSession
 * instantiates the Supabase client, so no network / no env mocking
 * needed. Pass-through paths (admin routes, unauth'd requests, GET
 * methods) require Supabase and are covered by Playwright instead.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import {
  IMPERSONATION_COOKIE,
  buildImpersonationCookiePayload,
  signImpersonationPayload,
} from "@/lib/admin-impersonation";
import { updateSession } from "./middleware";

const TEST_SECRET = "a".repeat(64);
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_ID = "22222222-2222-2222-2222-222222222222";

// Save + restore env so this suite doesn't leak state into other test
// files (vitest runs files in parallel but each in its own worker — the
// concern is intra-run resets). Some negative-case tests deliberately
// pass through the block and hit the Supabase client; we force dummy
// values so those calls fail fast in a controlled way rather than
// depending on whatever another file left in process.env.
const ENV_KEYS = [
  "IMPERSONATION_SIGNING_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.IMPERSONATION_SIGNING_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function makeSignedCookie(): string {
  const payload = buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID);
  return signImpersonationPayload(payload);
}

function makeRequest({
  method,
  path,
  cookie,
  headers = {},
}: {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  cookie?: string;
  headers?: Record<string, string>;
}): NextRequest {
  const url = `https://vendcast.co${path}`;
  const reqHeaders: Record<string, string> = { ...headers };
  if (cookie) {
    reqHeaders["cookie"] = `${IMPERSONATION_COOKIE}=${cookie}`;
  }
  return new NextRequest(url, { method, headers: reqHeaders });
}

describe("updateSession — impersonation mutation block (Commit 5b)", () => {
  it("blocks POST to non-admin API route with valid impersonation cookie", async () => {
    const req = makeRequest({
      method: "POST",
      path: "/api/pos/square/sync",
      cookie: makeSignedCookie(),
    });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-impersonation-blocked")).toBe("1");
    const body = await res.json();
    expect(body.error).toBe("Read-only impersonation active");
  });

  it.each([
    ["/api/pos/toast/sync", "POST"],
    ["/api/pos/clover/sync", "POST"],
    ["/api/team/invite", "POST"],
    ["/api/team/invite", "DELETE"],
    ["/api/dashboard/profile", "PATCH"],
  ] as const)("blocks %s %s with valid impersonation cookie", async (path, method) => {
    const req = makeRequest({ method, path, cookie: makeSignedCookie() });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-impersonation-blocked")).toBe("1");
  });

  it("blocks server action POST (Next-Action header) with valid cookie", async () => {
    // Server actions POST to page routes, not /api/*, but carry a
    // Next-Action header. Without that header, page-route POSTs would
    // slip through the block.
    const req = makeRequest({
      method: "POST",
      path: "/dashboard",
      cookie: makeSignedCookie(),
      headers: { "next-action": "action-hash-123" },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-impersonation-blocked")).toBe("1");
  });

  it("does NOT block when cookie signature is tampered", async () => {
    // Swap a char in the MIDDLE of the sig segment — all 6 bits of a
    // middle base64 char are meaningful, so flipping it guarantees the
    // decoded HMAC bytes differ. We avoided the last char on purpose:
    // in a 43-char base64url encoding of a 32-byte HMAC, the final
    // char's low 2 bits are throwaway padding. Flipping 'a' (26 =
    // 011010) ↔ 'b' (27 = 011011) only touches those padding bits, so
    // the decoded sig is byte-identical and verification still
    // succeeds — a ~3%-per-run flake, fixed here.
    //
    // HMAC verify fails on the tampered cookie, verifyImpersonationCookie
    // returns null, block does not fire. Assert via response: a 403
    // from the block would carry x-impersonation-blocked. Anything
    // else means the block didn't run. Any downstream Supabase
    // failure is fine — that proves we got PAST the block.
    const valid = makeSignedCookie();
    const dotIdx = valid.indexOf(".");
    // Flip a char 2 positions into the sig segment so no matter what
    // base64 alphabet boundary it lands on, the meaningful bits change.
    const tamperIdx = dotIdx + 2;
    const before = valid.slice(0, tamperIdx);
    const target = valid[tamperIdx];
    const after = valid.slice(tamperIdx + 1);
    // Swap into an alphabet char that's guaranteed distinct (swap 'A' ↔ 'Z').
    const swapped = target === "Z" ? "A" : "Z";
    const tampered = before + swapped + after;
    const req = makeRequest({
      method: "POST",
      path: "/api/pos/square/sync",
      cookie: tampered,
    });
    let res: Response | null = null;
    try {
      res = await updateSession(req);
    } catch {
      // Supabase client failure (expected with dummy env) — block did
      // not fire, test passes.
      return;
    }
    expect(res!.headers.get("x-impersonation-blocked")).toBeNull();
  });

  it("does NOT block when cookie payload has expired", async () => {
    // Build a payload with expiry in the past, sign it — signature is
    // still valid but verifyImpersonationCookie's expiry check (line
    // 163 of admin-impersonation.ts) rejects it.
    const expiredPayload = buildImpersonationCookiePayload(
      ADMIN_ID,
      TARGET_ID,
      Date.now() - 60 * 60 * 1000 // started 1h ago → expired 30min ago
    );
    const expiredCookie = signImpersonationPayload(expiredPayload);
    const req = makeRequest({
      method: "POST",
      path: "/api/pos/square/sync",
      cookie: expiredCookie,
    });
    let res: Response | null = null;
    try {
      res = await updateSession(req);
    } catch {
      return;
    }
    expect(res!.headers.get("x-impersonation-blocked")).toBeNull();
  });

  it("does NOT block /api/admin/* under impersonation (admin routes are exempt)", async () => {
    // Without this exemption, an admin couldn't stop their own
    // impersonation session because /api/admin/impersonate/stop would
    // 403. Hitting this path runs Supabase auth, which will fail on
    // dummy env — we accept either a non-block response OR an error.
    const req = makeRequest({
      method: "POST",
      path: "/api/admin/impersonate/stop",
      cookie: makeSignedCookie(),
    });
    let res: Response | null = null;
    try {
      res = await updateSession(req);
    } catch {
      return;
    }
    expect(res!.headers.get("x-impersonation-blocked")).toBeNull();
  });

  it("does NOT block GET requests even with a valid cookie", async () => {
    // GET is a read — impersonation is explicitly allowed to read.
    const req = makeRequest({
      method: "GET",
      path: "/api/pos/square/sync",
      cookie: makeSignedCookie(),
    });
    let res: Response | null = null;
    try {
      res = await updateSession(req);
    } catch {
      return;
    }
    expect(res!.headers.get("x-impersonation-blocked")).toBeNull();
  });

  it("does NOT block POST without impersonation cookie", async () => {
    const req = makeRequest({ method: "POST", path: "/api/pos/square/sync" });
    let res: Response | null = null;
    try {
      res = await updateSession(req);
    } catch {
      return;
    }
    expect(res!.headers.get("x-impersonation-blocked")).toBeNull();
  });
});
