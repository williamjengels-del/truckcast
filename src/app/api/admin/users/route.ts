import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

async function getServiceClient() {
  if (!(await getAdminUser())) return null;
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, business_name, city, state, subscription_tier, stripe_customer_id, stripe_subscription_id, trial_extended_until, data_sharing_enabled, onboarding_completed, created_at, last_payment_status, last_payment_failure_reason")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get event breakdown per user
  const { data: eventCounts } = await service
    .from("events")
    .select("user_id, booked, net_sales, event_date");

  const countMap: Record<string, number> = {};
  const bookedMap: Record<string, number> = {};
  const salesMap: Record<string, number> = {};
  const lastEventMap: Record<string, string> = {};

  for (const row of eventCounts ?? []) {
    countMap[row.user_id] = (countMap[row.user_id] ?? 0) + 1;
    if (row.booked) bookedMap[row.user_id] = (bookedMap[row.user_id] ?? 0) + 1;
    if (row.net_sales != null && row.net_sales > 0) salesMap[row.user_id] = (salesMap[row.user_id] ?? 0) + 1;
    if (!lastEventMap[row.user_id] || row.event_date > lastEventMap[row.user_id]) {
      lastEventMap[row.user_id] = row.event_date;
    }
  }

  // Get auth users for emails
  const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
  const emailMap: Record<string, string> = {};
  for (const u of authData?.users ?? []) {
    emailMap[u.id] = u.email ?? "";
  }

  const users = (profiles ?? []).map((p) => ({
    ...p,
    email: emailMap[p.id] ?? null,
    event_count: countMap[p.id] ?? 0,
    booked_count: bookedMap[p.id] ?? 0,
    sales_count: salesMap[p.id] ?? 0,
    last_event_date: lastEventMap[p.id] ?? null,
    trial_extended_until: p.trial_extended_until ?? null,
  }));

  return NextResponse.json({ users });
}

export async function DELETE(request: NextRequest) {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Prevent self-deletion. `getServiceClient()` above already gated on
  // admin status, so getAdminUser() here is guaranteed non-null — but
  // narrow the type explicitly for the compiler.
  const me = await getAdminUser();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (me.id === userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  // Capture profile + email BEFORE delete so the audit row has context
  // (the humans reading /admin/activity want to see "deleted Jane's
  // Food Truck", not a bare uuid).
  const { data: profileSnapshot } = await service
    .from("profiles")
    .select("business_name")
    .eq("id", userId)
    .maybeSingle();
  const { data: authUser } = await service.auth.admin.getUserById(userId);

  // Delete all user data in order (respect FK constraints)
  await service.from("event_performance").delete().eq("user_id", userId);
  await service.from("events").delete().eq("user_id", userId);
  await service.from("contacts").delete().eq("user_id", userId);
  await service.from("booking_requests").delete().eq("truck_user_id", userId);
  await service.from("follow_subscribers").delete().eq("truck_user_id", userId);
  await service.from("feedback").delete().eq("user_id", userId);
  await service.from("profiles").delete().eq("id", userId);

  // Delete the auth user last
  const { error: authError } = await service.auth.admin.deleteUser(userId);
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

  await logAdminAction(
    {
      adminUserId: me.id,
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      metadata: {
        email: authUser?.user?.email ?? null,
        business_name: profileSnapshot?.business_name ?? null,
      },
    },
    service
  );

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  // We need the current subscription_tier BEFORE mutating, so the audit
  // row can record "from -> to". Pull it now if the caller is changing
  // the tier.
  let previousTier: string | null = null;
  if (body.subscription_tier !== undefined) {
    const { data: prev } = await service
      .from("profiles")
      .select("subscription_tier")
      .eq("id", userId)
      .maybeSingle();
    previousTier = prev?.subscription_tier ?? null;
  }

  // Update subscription tier
  if (body.subscription_tier !== undefined) {
    const validTiers = ["starter", "pro", "premium"];
    if (!validTiers.includes(body.subscription_tier)) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }
    updateData.subscription_tier = body.subscription_tier;
  }

  // Extend trial by N days (admin tool for beta users)
  let trialExtendDays: number | null = null;
  let trialExtendUntilIso: string | null = null;
  if (body.extend_trial_days !== undefined) {
    const days = parseInt(body.extend_trial_days, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: "extend_trial_days must be 1–365" }, { status: 400 });
    }
    const extendUntil = new Date();
    extendUntil.setDate(extendUntil.getDate() + days);
    trialExtendDays = days;
    trialExtendUntilIso = extendUntil.toISOString();
    updateData.trial_extended_until = trialExtendUntilIso;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await service
    .from("profiles")
    .update(updateData)
    .eq("id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log each semantic action separately — a single PATCH can carry a
  // tier change AND a trial extension, but they're two distinct
  // policy decisions and the activity feed should reflect both.
  if (body.subscription_tier !== undefined) {
    await logAdminAction(
      {
        adminUserId: admin.id,
        action: "user.tier_change",
        targetType: "user",
        targetId: userId,
        metadata: { from: previousTier, to: body.subscription_tier },
      },
      service
    );
  }
  if (trialExtendDays !== null) {
    await logAdminAction(
      {
        adminUserId: admin.id,
        action: "user.trial_extend",
        targetType: "user",
        targetId: userId,
        metadata: { days: trialExtendDays, until: trialExtendUntilIso },
      },
      service
    );
  }

  return NextResponse.json({ success: true });
}
