import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

/**
 * POST /api/admin/users/[userId]/mfa-reset
 *
 * Admin-only path to reset 2FA for a locked-out operator. Powers the
 * support@vendcast.co policy — when an operator emails saying they've
 * lost their authenticator AND their recovery codes, the admin verifies
 * identity out-of-band and then hits this endpoint to clear their TOTP
 * factor + remaining recovery codes.
 *
 * After reset, the next time the operator logs in they'll skip the
 * /login/2fa challenge (no factor exists) and reach /dashboard. They
 * can then re-enroll TOTP from /dashboard/settings#security.
 *
 * Audit-logged as `user.mfa_reset` with metadata { factors_deleted,
 * recovery_codes_deleted, email }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Don't reset your own MFA via this admin route — admins should disable
  // their own 2FA through the regular settings flow (which requires AAL2,
  // a real check that you control the factor). Self-reset via admin
  // bypass would be a backdoor against the admin's own account.
  if (userId === admin.id) {
    return NextResponse.json(
      {
        error:
          "Use /dashboard/settings to disable your own 2FA — admin reset is for other users.",
      },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Look up the target user — capture email for the audit row before
  // we touch anything.
  const { data: target } = await service.auth.admin.getUserById(userId);
  if (!target?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const email = target.user.email ?? null;

  // List + delete TOTP factors.
  const { data: factorsData, error: listErr } =
    await service.auth.admin.mfa.listFactors({ userId });
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const totpFactors = (factorsData?.factors ?? []).filter(
    (f) => f.factor_type === "totp"
  );

  let factorsDeleted = 0;
  for (const factor of totpFactors) {
    const { error: deleteErr } = await service.auth.admin.mfa.deleteFactor({
      userId,
      id: factor.id,
    });
    if (deleteErr) {
      return NextResponse.json(
        { error: `Failed to delete factor ${factor.id}: ${deleteErr.message}` },
        { status: 500 }
      );
    }
    factorsDeleted++;
  }

  // Wipe recovery codes too — they were tied to the now-deleted factor.
  // Capture the count first so we can report it back.
  const { count: existingCodeCount } = await service
    .from("profile_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const { error: codeDeleteErr } = await service
    .from("profile_recovery_codes")
    .delete()
    .eq("user_id", userId);
  if (codeDeleteErr) {
    return NextResponse.json(
      { error: codeDeleteErr.message },
      { status: 500 }
    );
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.mfa_reset",
      targetType: "user",
      targetId: userId,
      metadata: {
        email,
        factors_deleted: factorsDeleted,
        recovery_codes_deleted: existingCodeCount ?? 0,
      },
    },
    service
  );

  return NextResponse.json({
    ok: true,
    factors_deleted: factorsDeleted,
    recovery_codes_deleted: existingCodeCount ?? 0,
  });
}
