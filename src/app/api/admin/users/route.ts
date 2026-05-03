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

// PostgREST defaults to 1000 rows per select() without an explicit range.
// These helpers page through in 1000-row batches so the admin view shows
// real totals rather than silent ceilings. Sibling of PR #21 on event-data.
const BATCH_SIZE = 1000;

interface AdminProfileRow {
  id: string;
  business_name: string | null;
  city: string | null;
  state: string | null;
  subscription_tier: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_extended_until: string | null;
  data_sharing_enabled: boolean | null;
  onboarding_completed: boolean | null;
  created_at: string;
  last_payment_status: string | null;
  last_payment_failure_reason: string | null;
}

async function fetchManagerUserIds(
  service: NonNullable<Awaited<ReturnType<typeof getServiceClient>>>
): Promise<Set<string>> {
  // Defense in depth (2026-05-02): the original manager filter only
  // excluded profiles where owner_user_id IS NULL. But if a manager
  // signed up via /signup before being added to a team (or otherwise
  // got a profile without going through the accept-invite flow that
  // sets owner_user_id), they'd slip through.
  //
  // This second-level filter pulls every active team_members row and
  // excludes any profile whose ID appears as member_user_id. Together
  // with the owner_user_id filter, no manager can show up in the
  // admin operator-users list regardless of which signup path they
  // took.
  const out = new Set<string>();
  const { data } = await service
    .from("team_members")
    .select("member_user_id")
    .eq("status", "active")
    .not("member_user_id", "is", null);
  for (const row of (data ?? []) as { member_user_id: string | null }[]) {
    if (row.member_user_id) out.add(row.member_user_id);
  }
  return out;
}

async function fetchAllProfiles(
  service: NonNullable<Awaited<ReturnType<typeof getServiceClient>>>
): Promise<AdminProfileRow[]> {
  // Operator-only — manager profiles (owner_user_id IS NOT NULL) are
  // staff seats invited via the operator's settings → Team Members
  // flow, not separate vendor signups. Counting them in admin user
  // metrics inflated growth + tier breakdown.
  //
  // The team_members second-level filter is applied in GET() below
  // to catch managers whose profile owner_user_id never got set.
  const all: AdminProfileRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await service
      .from("profiles")
      .select("id, business_name, city, state, subscription_tier, stripe_customer_id, stripe_subscription_id, trial_extended_until, data_sharing_enabled, onboarding_completed, created_at, last_payment_status, last_payment_failure_reason")
      .is("owner_user_id", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as AdminProfileRow[]));
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return all;
}

async function fetchAllEvents(
  service: NonNullable<Awaited<ReturnType<typeof getServiceClient>>>
) {
  const all: Array<{ user_id: string; booked: boolean | null; net_sales: number | null; event_date: string }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await service
      .from("events")
      .select("user_id, booked, net_sales, event_date")
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as typeof all));
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return all;
}

// auth.admin.listUsers is 1-indexed and returns { users, aud, … }.
// No explicit totalPages in the response; paginate until a short page.
async function fetchAllAuthUsers(
  service: NonNullable<Awaited<ReturnType<typeof getServiceClient>>>
) {
  const all: Array<{ id: string; email: string | null | undefined }> = [];
  let page = 1;
  while (true) {
    const { data } = await service.auth.admin.listUsers({ page, perPage: BATCH_SIZE });
    const batch = data?.users ?? [];
    if (batch.length === 0) break;
    all.push(...batch.map((u) => ({ id: u.id, email: u.email })));
    if (batch.length < BATCH_SIZE) break;
    page++;
  }
  return all;
}

export async function GET() {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let profiles: Awaited<ReturnType<typeof fetchAllProfiles>>;
  let eventCounts: Awaited<ReturnType<typeof fetchAllEvents>>;
  let authUsers: Awaited<ReturnType<typeof fetchAllAuthUsers>>;
  let managerIds: Set<string>;
  try {
    [profiles, eventCounts, authUsers, managerIds] = await Promise.all([
      fetchAllProfiles(service),
      fetchAllEvents(service),
      fetchAllAuthUsers(service),
      fetchManagerUserIds(service),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }

  const countMap: Record<string, number> = {};
  const bookedMap: Record<string, number> = {};
  const salesMap: Record<string, number> = {};
  const lastEventMap: Record<string, string> = {};

  for (const row of eventCounts) {
    countMap[row.user_id] = (countMap[row.user_id] ?? 0) + 1;
    if (row.booked) bookedMap[row.user_id] = (bookedMap[row.user_id] ?? 0) + 1;
    if (row.net_sales != null && row.net_sales > 0) salesMap[row.user_id] = (salesMap[row.user_id] ?? 0) + 1;
    if (!lastEventMap[row.user_id] || row.event_date > lastEventMap[row.user_id]) {
      lastEventMap[row.user_id] = row.event_date;
    }
  }

  const emailMap: Record<string, string> = {};
  for (const u of authUsers) {
    emailMap[u.id] = u.email ?? "";
  }

  // Defensive second filter — drop any profile whose ID also appears in
  // active team_members.member_user_id. Catches managers whose profile
  // owner_user_id never got set by the accept-invite flow (signup
  // happened before invite, or otherwise bypassed the proper path).
  const users = (profiles ?? [])
    .filter((p) => !managerIds.has(p.id))
    .map((p) => ({
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
