// HMAC-SHA256 tokens for one-click email unsubscribe links — CAN-SPAM
// compliance for marketing-grade emails (welcome, weekly-digest, trial
// warnings, onboarding-nudge, sales-reminders).
//
// CAN-SPAM requires an "internet-based mechanism" for opt-out that
// works without the recipient logging in. The previous footer linked
// to /dashboard/settings?tab=notifications, which requires an auth
// session — that's a borderline violation. A signed per-user link
// flips `profiles.email_reminders_enabled` to false on click.
//
// Token shape: HMAC-SHA256(secret, "unsubscribe:<userId>") in hex.
// Constant-time compare on verify. Tokens are NOT time-bounded — a
// link from a years-old email should still let the operator opt out;
// CAN-SPAM doesn't permit silently expiring an opt-out path. The
// HMAC tying the token to a specific userId is the security gate.
//
// Mirrors the pattern in `admin-impersonation.ts` — same fail-closed
// secret-missing behavior, same `timingSafeEqual` discipline.

import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET is missing or too short (need >=32 chars)"
    );
  }
  return s;
}

function tokenMessage(userId: string): string {
  return `unsubscribe:${userId}`;
}

/**
 * Sign a per-user unsubscribe token. Returns hex-encoded HMAC-SHA256.
 * Embed in marketing email footer URLs as `&t=<token>`.
 */
export function signUnsubscribeToken(userId: string): string {
  return createHmac("sha256", getSecret())
    .update(tokenMessage(userId))
    .digest("hex");
}

/**
 * Verify a token matches the userId. Returns true on match, false on
 * any failure (bad hex, bad length, signature mismatch, secret missing
 * — never throws). Use constant-time compare to defeat timing attacks
 * even though the per-token-per-user shape makes those impractical.
 */
export function verifyUnsubscribeToken(
  userId: string,
  token: string | null | undefined
): boolean {
  if (!userId || !token) return false;
  try {
    const expected = Buffer.from(signUnsubscribeToken(userId), "hex");
    let provided: Buffer;
    try {
      provided = Buffer.from(token, "hex");
    } catch {
      return false;
    }
    if (expected.length === 0 || expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

/**
 * Build the full unsubscribe URL embedded in marketing email footers.
 * `baseUrl` defaults to https://vendcast.co — pass an override for
 * preview/staging if needed.
 */
export function buildUnsubscribeUrl(
  userId: string,
  baseUrl: string = "https://vendcast.co"
): string {
  const token = signUnsubscribeToken(userId);
  return `${baseUrl}/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
}
