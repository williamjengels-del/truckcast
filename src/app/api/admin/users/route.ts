import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "williamjengels@gmail.com";

async function getServiceClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return null;
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
    .select("id, business_name, city, state, subscription_tier, stripe_customer_id, data_sharing_enabled, onboarding_completed, created_at")
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
  }));

  return NextResponse.json({ users });
}

export async function DELETE(request: NextRequest) {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Prevent self-deletion
  const supabase = await createClient();
  const { data: { user: me } } = await supabase.auth.getUser();
  if (me?.id === userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

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

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, subscription_tier } = await request.json();

  if (!userId || !subscription_tier) {
    return NextResponse.json({ error: "userId and subscription_tier required" }, { status: 400 });
  }

  const validTiers = ["starter", "pro", "premium"];
  if (!validTiers.includes(subscription_tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const { error } = await service
    .from("profiles")
    .update({ subscription_tier })
    .eq("id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
