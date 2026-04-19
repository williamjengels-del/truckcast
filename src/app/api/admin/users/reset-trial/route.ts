import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

// POST /api/admin/users/reset-trial
// Body: { userId }
//
// Gives the target user a fresh 14-day trial by setting
// trial_extended_until = now + 14 days. Reuses the existing
// trial_extended_until column rather than introducing a dedicated
// trial_reset_at field — the middleware already treats that column
// as "trial is active until X", which is the exact semantic we want.
//
// Distinct from /api/admin/users PATCH with extend_trial_days=14 only
// by the audit log action name (user.trial_reset vs user.trial_extend).
// Operationally identical but the activity page filter + future
// reporting can tell them apart, which matters: "reset" is typically
// a second-chance for a lapsed beta user, "extend" is a push beyond
// the default window for someone still actively evaluating.
//
// Rejected when the target already has a Stripe subscription —
// resetting a trial for a paying user is nonsense. Admin should just
// adjust the tier or cancel the subscription through Stripe instead.

const FRESH_TRIAL_DAYS = 14;

export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { userId } = body;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pre-check: user exists and is actually on a trial (starter tier,
  // no active subscription). Mirrors the button's client-side gate —
  // defense in depth so a direct POST can't bypass the UI guard.
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, subscription_tier, stripe_subscription_id, trial_extended_until")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json(
      { error: `No profile found for userId ${userId}` },
      { status: 404 }
    );
  }
  const typedProfile = profile as {
    subscription_tier: string;
    stripe_subscription_id: string | null;
    trial_extended_until: string | null;
  };
  if (typedProfile.stripe_subscription_id) {
    return NextResponse.json(
      {
        error:
          "Cannot reset trial — user has an active Stripe subscription. Adjust tier or cancel subscription instead.",
      },
      { status: 400 }
    );
  }
  if (typedProfile.subscription_tier !== "starter") {
    return NextResponse.json(
      {
        error: `Cannot reset trial — user is on ${typedProfile.subscription_tier} tier. Trial gate doesn't apply; reset is a no-op.`,
      },
      { status: 400 }
    );
  }

  const previousExtendedUntil = typedProfile.trial_extended_until;

  const newExtendedUntil = new Date(
    Date.now() + FRESH_TRIAL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error: updateError } = await service
    .from("profiles")
    .update({ trial_extended_until: newExtendedUntil })
    .eq("id", userId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.trial_reset",
      targetType: "user",
      targetId: userId,
      metadata: {
        days: FRESH_TRIAL_DAYS,
        until: newExtendedUntil,
        previous_extended_until: previousExtendedUntil,
      },
    },
    service
  );

  return NextResponse.json({
    success: true,
    trial_extended_until: newExtendedUntil,
  });
}
