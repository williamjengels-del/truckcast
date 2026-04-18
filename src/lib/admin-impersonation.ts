// Read-only admin impersonation ("view dashboard as this user").
//
// Architecture: Option B from the design review — signed cookie layered
// on top of the admin's real Supabase auth session. The admin stays
// logged in as themselves; a separate `vc_impersonate` cookie carries
// a signed payload identifying the impersonation target. The rest of
// the app resolves the "effective" user via getEffectiveUserId().
//
// Why signed instead of session-swap:
//   * Admin JWT is never moved, cached, or restored from storage.
//   * Supabase auth logs stay honest — no fake login events for the
//     target user.
//   * Exit is instant (just clear the cookie). No session-restoration
//     plumbing needed.
//   * Audit log is the authoritative record, distinct from the auth
//     trail.
//
// Security model:
//   * Cookie payload is HMAC-SHA256-signed with IMPERSONATION_SIGNING_SECRET.
//     Tampering is detected; clients cannot forge a valid cookie.
//   * Fixed 30-minute expiry from start (non-sliding). Expiry is
//     embedded in the payload AND set as the cookie's Max-Age — a
//     stale cookie fails signature+expiry validation inside the app
//     regardless of browser-side eviction.
//   * HttpOnly + Secure + SameSite=Lax — standard hardening.
//   * Cookie by itself grants nothing. getImpersonationContext() is
//     consumed by code paths that ALSO verify the current auth user
//     is still an admin; a stolen cookie on a non-admin session is
//     inert because the mutation block + effective-id resolution both
//     require real admin auth to activate.
//   * Fail-closed on missing env var: if IMPERSONATION_SIGNING_SECRET
//     is absent, signing and verification both throw — no silent
//     bypass, no silent acceptance of unsigned cookies.

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const IMPERSONATION_COOKIE = "vc_impersonate";
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000; // 30 minutes, fixed

export interface ImpersonationContext {
  /** The user_id of the account being impersonated (target of the view). */
  targetUserId: string;
  /** The user_id of the admin who initiated the impersonation. */
  adminUserId: string;
  /** Epoch ms when impersonation started. */
  startedAt: number;
  /** Epoch ms when impersonation expires (startedAt + TTL). */
  expiresAt: number;
}

/**
 * Wire format of the signed cookie payload. Short keys to keep the
 * cookie small under typical Vercel limits.
 */
interface CookiePayload {
  t: string; // target_user_id
  a: string; // admin_user_id
  s: number; // started_at (epoch ms)
  e: number; // expires_at (epoch ms)
}

// ═══════════════════════════════════════════════════════════════════════
// base64url — RFC 4648 §5 (URL-safe, no padding)
// Plain atob/btoa would need escaping in cookie values; base64url is
// safe to drop straight into a Set-Cookie header.
// ═══════════════════════════════════════════════════════════════════════

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

// ═══════════════════════════════════════════════════════════════════════
// Signing
// ═══════════════════════════════════════════════════════════════════════

function getSigningSecret(): string {
  const secret = process.env.IMPERSONATION_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    // Fail-closed. If the env var is missing we do NOT silently fall
    // back to a dev key — production misconfig would grant open
    // impersonation. Callers surface this as a 500.
    throw new Error(
      "IMPERSONATION_SIGNING_SECRET is missing or too short (need >=32 chars)"
    );
  }
  return secret;
}

function hmac(message: string): Buffer {
  return createHmac("sha256", getSigningSecret()).update(message).digest();
}

/**
 * Sign a payload and return the cookie value `<payload>.<sig>`.
 * Exported for the start route.
 */
export function signImpersonationPayload(payload: CookiePayload): string {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(json, "utf8"));
  const sig = hmac(payloadB64);
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify and decode a cookie value. Returns the context on success,
 * null on any failure (bad format, bad signature, expired, missing
 * fields). Never throws — callers can treat null as "no active
 * impersonation" uniformly regardless of cause.
 */
export function verifyImpersonationCookie(
  value: string
): ImpersonationContext | null {
  if (!value || !value.includes(".")) return null;

  const dot = value.indexOf(".");
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;

  // Constant-time signature comparison.
  let expectedSig: Buffer;
  let providedSig: Buffer;
  try {
    expectedSig = hmac(payloadB64);
    providedSig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (expectedSig.length !== providedSig.length) return null;
  if (!timingSafeEqual(expectedSig, providedSig)) return null;

  // Signature OK — decode payload.
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<CookiePayload>;
  if (
    typeof p.t !== "string" ||
    typeof p.a !== "string" ||
    typeof p.s !== "number" ||
    typeof p.e !== "number"
  ) {
    return null;
  }

  // Expiry check (fail-closed regardless of browser Max-Age).
  if (Date.now() >= p.e) return null;

  return {
    targetUserId: p.t,
    adminUserId: p.a,
    startedAt: p.s,
    expiresAt: p.e,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Cookie I/O (server-side only — this file must never be imported into
// client components; cookies() is a server function)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Read the current impersonation context from the request cookies.
 * Returns null if no cookie, invalid signature, expired, or malformed.
 *
 * Callers that also need to gate on admin-status should pair this with
 * getAdminUser() and confirm the current authenticated user's id
 * matches ctx.adminUserId (prevents cookie reuse across different
 * admin sessions).
 */
export async function getImpersonationContext(): Promise<ImpersonationContext | null> {
  const jar = await cookies();
  const raw = jar.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;
  return verifyImpersonationCookie(raw);
}

/**
 * Resolve which user's data should be loaded for a dashboard read.
 * Returns the impersonation target when an admin is actively
 * impersonating, otherwise returns the real user's id.
 *
 *   - realUser must be the currently-authenticated user (from
 *     supabase.auth.getUser()). Passing null returns null — no
 *     impersonation happens against an unauthenticated request.
 *   - If a signed cookie claims admin_user_id X but the real user is
 *     Y, we IGNORE the cookie. This prevents a cookie leaked to a
 *     different browser from granting access. Impersonation is valid
 *     only for the admin who started it.
 *
 * Callers in read paths (dashboard pages, non-admin GET routes) use
 * this to scope their queries. Callers in mutation paths do NOT use
 * this — mutations are blocked outright when impersonation is active
 * (see Commit 5b proxy mutation block).
 */
export async function getEffectiveUserId(
  realUser: { id: string } | null
): Promise<string | null> {
  if (!realUser) return null;
  const ctx = await getImpersonationContext();
  if (!ctx) return realUser.id;
  if (ctx.adminUserId !== realUser.id) return realUser.id;
  return ctx.targetUserId;
}

// ═══════════════════════════════════════════════════════════════════════
// Construction helpers for the start/stop routes
// ═══════════════════════════════════════════════════════════════════════

export function buildImpersonationCookiePayload(
  adminUserId: string,
  targetUserId: string,
  now: number = Date.now()
): CookiePayload {
  return {
    t: targetUserId,
    a: adminUserId,
    s: now,
    e: now + IMPERSONATION_TTL_MS,
  };
}

/**
 * Max-Age in seconds for the Set-Cookie header. Browser-side eviction
 * matches the in-payload expiry.
 */
export const IMPERSONATION_COOKIE_MAX_AGE_SECONDS = Math.floor(
  IMPERSONATION_TTL_MS / 1000
);
