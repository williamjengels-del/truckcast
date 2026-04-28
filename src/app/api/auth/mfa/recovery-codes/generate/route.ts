import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  formatRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "@/lib/recovery-codes";

/**
 * POST /api/auth/mfa/recovery-codes/generate
 *
 * Generates a fresh batch of `RECOVERY_CODE_COUNT` recovery codes for
 * the authenticated operator. Wipes any existing codes (regenerate
 * semantics — old codes become invalid). Returns plaintext codes once
 * — the caller is expected to display them and never request them
 * again. After this endpoint returns, the only way to recover access
 * if the operator loses their authenticator AND the codes is the
 * admin-reset path documented in src/app/(auth)/login/2fa/page.tsx.
 *
 * Caller must already be authenticated (any AAL level — this endpoint
 * is reachable from the post-enroll flow where the operator just
 * completed a TOTP challenge, OR from settings where they want to
 * regenerate while already at AAL2). The proxy AAL gate exempts
 * /api/auth/mfa/* so AAL1 sessions can still generate codes during
 * the initial enroll flow before the AAL2 step-up happens.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const codes = generateRecoveryCodes();

  // Service-role client — RLS lets the user DELETE their own rows,
  // but using the service role here keeps the write path consistent
  // with the verify endpoint and avoids a partial cleanup if the
  // user-scoped delete fails for any reason.
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Wipe any existing codes — regenerate fully invalidates the old set.
  const { error: deleteErr } = await service
    .from("profile_recovery_codes")
    .delete()
    .eq("user_id", user.id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  const rows = codes.map((code) => ({
    user_id: user.id,
    code_hash: hashRecoveryCode(code),
  }));

  const { error: insertErr } = await service
    .from("profile_recovery_codes")
    .insert(rows);
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    codes: codes.map((c) => formatRecoveryCode(c)),
    count: RECOVERY_CODE_COUNT,
  });
}
