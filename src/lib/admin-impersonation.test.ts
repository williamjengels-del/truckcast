/**
 * Tests for the impersonation cookie signing primitives.
 *
 * Scope is deliberately narrow — covers the pure crypto layer:
 * sign/verify round-trip, tamper detection, expiry, missing-field
 * rejection. Cookie I/O (next/headers) and the /api/admin/impersonate/*
 * routes are smoke-tested against the live deployment, not here.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  buildImpersonationCookiePayload,
  signImpersonationPayload,
  verifyImpersonationCookie,
  IMPERSONATION_TTL_MS,
} from "./admin-impersonation";

const TEST_SECRET = "a".repeat(64); // 512 bits of "a" — deterministic for tests
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_ID = "22222222-2222-2222-2222-222222222222";

beforeAll(() => {
  process.env.IMPERSONATION_SIGNING_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.IMPERSONATION_SIGNING_SECRET;
});

describe("signImpersonationPayload / verifyImpersonationCookie round-trip", () => {
  it("signs and verifies a fresh payload", () => {
    const payload = buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID);
    const cookie = signImpersonationPayload(payload);
    const ctx = verifyImpersonationCookie(cookie);
    expect(ctx).not.toBeNull();
    expect(ctx?.adminUserId).toBe(ADMIN_ID);
    expect(ctx?.targetUserId).toBe(TARGET_ID);
    expect(ctx?.startedAt).toBe(payload.s);
    expect(ctx?.expiresAt).toBe(payload.e);
  });

  it("includes a dot separator in the cookie format", () => {
    const payload = buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID);
    const cookie = signImpersonationPayload(payload);
    expect(cookie).toContain(".");
    expect(cookie.split(".").length).toBe(2);
  });

  it("sets expiry 30 minutes after start by default", () => {
    const now = 1_700_000_000_000;
    const payload = buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID, now);
    expect(payload.e - payload.s).toBe(IMPERSONATION_TTL_MS);
    expect(IMPERSONATION_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe("verifyImpersonationCookie — tamper detection", () => {
  it("rejects a cookie with a flipped signature byte", () => {
    const cookie = signImpersonationPayload(
      buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID)
    );
    const [payload, sig] = cookie.split(".");
    // Flip one char in the signature portion.
    const badSig = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    const tampered = `${payload}.${badSig}`;
    expect(verifyImpersonationCookie(tampered)).toBeNull();
  });

  it("rejects a cookie with a modified payload", () => {
    const cookie = signImpersonationPayload(
      buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID)
    );
    const [payload, sig] = cookie.split(".");
    const badPayload = payload.slice(0, -2) + "zz";
    expect(verifyImpersonationCookie(`${badPayload}.${sig}`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookie = signImpersonationPayload(
      buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID)
    );
    const originalSecret = process.env.IMPERSONATION_SIGNING_SECRET;
    process.env.IMPERSONATION_SIGNING_SECRET = "b".repeat(64);
    try {
      expect(verifyImpersonationCookie(cookie)).toBeNull();
    } finally {
      process.env.IMPERSONATION_SIGNING_SECRET = originalSecret;
    }
  });

  it("rejects non-token strings", () => {
    expect(verifyImpersonationCookie("")).toBeNull();
    expect(verifyImpersonationCookie("notacookie")).toBeNull();
    expect(verifyImpersonationCookie(".")).toBeNull();
    expect(verifyImpersonationCookie("onlyleft.")).toBeNull();
    expect(verifyImpersonationCookie(".onlyright")).toBeNull();
  });
});

describe("verifyImpersonationCookie — expiry", () => {
  it("rejects an expired payload even with valid signature", () => {
    // Build a payload whose expiry is in the past.
    const pastStart = Date.now() - 2 * IMPERSONATION_TTL_MS;
    const payload = buildImpersonationCookiePayload(
      ADMIN_ID,
      TARGET_ID,
      pastStart
    );
    // At this point payload.e < Date.now().
    const cookie = signImpersonationPayload(payload);
    expect(verifyImpersonationCookie(cookie)).toBeNull();
  });

  it("accepts a payload one second before expiry", () => {
    // Built with start = now - (TTL - 1s). Expiry is 1s in the future.
    const start = Date.now() - (IMPERSONATION_TTL_MS - 1000);
    const payload = buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID, start);
    const cookie = signImpersonationPayload(payload);
    const ctx = verifyImpersonationCookie(cookie);
    expect(ctx).not.toBeNull();
    expect(ctx?.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("verifyImpersonationCookie — field validation", () => {
  it("rejects a payload missing required fields", () => {
    // Construct a cookie with a payload that has only partial fields.
    // We have to reach into the wire format to do this — emulate what a
    // poorly-written forger might send.
    const crypto = require("crypto") as typeof import("crypto");
    const partial = { t: TARGET_ID, a: ADMIN_ID }; // missing s and e
    const payloadB64 = Buffer.from(JSON.stringify(partial))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const sig = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(payloadB64)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifyImpersonationCookie(`${payloadB64}.${sig}`)).toBeNull();
  });
});

describe("signImpersonationPayload — missing secret", () => {
  it("throws fail-closed when IMPERSONATION_SIGNING_SECRET is unset", () => {
    const original = process.env.IMPERSONATION_SIGNING_SECRET;
    delete process.env.IMPERSONATION_SIGNING_SECRET;
    try {
      expect(() =>
        signImpersonationPayload(
          buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID)
        )
      ).toThrow(/IMPERSONATION_SIGNING_SECRET/);
    } finally {
      process.env.IMPERSONATION_SIGNING_SECRET = original;
    }
  });

  it("throws fail-closed when IMPERSONATION_SIGNING_SECRET is too short", () => {
    const original = process.env.IMPERSONATION_SIGNING_SECRET;
    process.env.IMPERSONATION_SIGNING_SECRET = "short";
    try {
      expect(() =>
        signImpersonationPayload(
          buildImpersonationCookiePayload(ADMIN_ID, TARGET_ID)
        )
      ).toThrow(/32 chars/);
    } finally {
      process.env.IMPERSONATION_SIGNING_SECRET = original;
    }
  });
});
