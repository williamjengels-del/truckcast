import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  hashRecoveryCode,
  isWellFormedRecoveryCode,
} from "@/lib/recovery-codes";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import { sendMfaDisabledViaRecoveryEmail } from "@/lib/email";

// mfa-3: 5 attempts per IP per hour. Recovery codes are 10-character
// base32-ish strings — at 5/hour an attacker brute-forcing the
// keyspace would need ~10^14 hours per IP. The legitimate operator
// using a recovery code typically gets it right on the first try
// from their saved list, so 5/hour is well above any plausible
// real-use volume.
const RECOVERY_VERIFY_RATE_LIMIT = 5;
const RECOVERY_VERIFY_RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/auth/mfa/recovery-codes/verify
 *
 * Body: { code: string }
 *
 * Recovery-code path through the 2FA challenge surface. Used when the
 * operator has lost access to their authenticator app but still has a
 * recovery code on hand. On match:
 *   1. Mark the code consumed (audit trail).
 *   2. Delete the operator's TOTP factor entirely. The session's AAL
 *      gate becomes a no-op once the factor is gone, so the operator
 *      regains dashboard access without needing an explicit AAL2
 *      cookie elevation.
 *   3. Delete the remaining unused recovery codes — they were tied to
 *      the now-deleted factor and shouldn't be reusable.
 *
 * After success the operator is signed in (AAL1) with no factor. The
 * client should redirect them to /dashboard/settings#security so they
 * can re-enroll TOTP from scratch. The fresh batch of recovery codes
 * is generated as part of that re-enroll.
 *
 * Reachable from /login/2fa as the "Use a recovery code" fallback.
 * The proxy AAL gate exempts /api/auth/mfa/* so this endpoint runs
 * even at AAL1.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // mfa-3: rate limit BEFORE doing any work. Key on (user.id, ip)
  // composite so an attacker controlling one user's session can't
  // brute-force from a single IP, AND a legitimate operator behind a
  // shared IP (corporate NAT) doesn't get blocked because someone
  // else on the same IP is fumbling THEIR recovery codes.
  const ip = clientIpFromRequest(request);
  const rateKey = `mfa-recovery:${user.id}:${ip}`;
  if (
    !checkRateLimit(
      rateKey,
      RECOVERY_VERIFY_RATE_LIMIT,
      RECOVERY_VERIFY_RATE_WINDOW_MS
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Too many recovery code attempts. Wait a few minutes before trying again, or contact support@vendcast.co.",
      },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const code = (body as { code?: string } | null)?.code;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }
  if (!isWellFormedRecoveryCode(code)) {
    return NextResponse.json(
      { error: "Invalid recovery code format" },
      { status: 400 }
    );
  }

  const candidateHash = hashRecoveryCode(code);

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find a matching unconsumed code. Limit to this user — service role
  // bypasses RLS so we filter explicitly.
  const { data: match } = await service
    .from("profile_recovery_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", candidateHash)
    .is("consumed_at", null)
    .maybeSingle();

  if (!match) {
    // Constant-ish 401 — don't leak whether the code shape was right
    // but the value was wrong, vs simply unknown. The well-formedness
    // check upstream already rejects gibberish.
    return NextResponse.json(
      { error: "Recovery code not recognized or already used" },
      { status: 401 }
    );
  }

  // Mark consumed (audit trail; the row gets deleted next, but we
  // do this first in case something goes sideways with the factor
  // deletion below — better to have a "consumed but not yet recovered"
  // state than the opposite).
  await service
    .from("profile_recovery_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", match.id);

  // Delete the operator's TOTP factors via the admin API. listFactors
  // / deleteFactor on the admin namespace are factor-management calls
  // that don't require an active user session — they operate by id.
  const { data: factorsData } = await service.auth.admin.mfa.listFactors({
    userId: user.id,
  });
  const factors = factorsData?.factors ?? [];
  for (const factor of factors) {
    if (factor.factor_type === "totp") {
      await service.auth.admin.mfa.deleteFactor({
        userId: user.id,
        id: factor.id,
      });
    }
  }

  // Cleanup remaining recovery codes — they were tied to the deleted
  // factor; a future enroll will generate a fresh batch.
  await service
    .from("profile_recovery_codes")
    .delete()
    .eq("user_id", user.id);

  // mfa-4: notify the operator that 2FA was just disabled. Pre-fix
  // this was silent — an attacker with both password and a single
  // recovery code could disable 2FA without any signal to the
  // legitimate operator. Fire-and-forget so email infrastructure
  // issues don't fail the recovery flow itself.
  if (user.email) {
    const { data: profile } = await service
      .from("profiles")
      .select("business_name")
      .eq("id", user.id)
      .maybeSingle();
    sendMfaDisabledViaRecoveryEmail({
      to: user.email,
      businessName:
        (profile as { business_name: string | null } | null)?.business_name ??
        "",
      ip,
      consumedAt: new Date().toISOString(),
    }).catch((err) => {
      console.warn("[mfa-recovery] notify email failed:", err);
    });
  }

  return NextResponse.json({ ok: true });
}
