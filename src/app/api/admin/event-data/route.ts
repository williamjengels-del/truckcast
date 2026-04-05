import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "williamjengels@gmail.com";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const service = getServiceClient();

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const filterSharing = searchParams.get("sharing"); // "all" | "opted_in" | "opted_out"
  const search = searchParams.get("q") ?? "";

  // Fetch profiles to build user lookup (only data_sharing_enabled users unless filter says otherwise)
  let profileQuery = service
    .from("profiles")
    .select("id, business_name, city, state, data_sharing_enabled");

  if (filterSharing === "opted_in") {
    profileQuery = profileQuery.eq("data_sharing_enabled", true);
  } else if (filterSharing === "opted_out") {
    profileQuery = profileQuery.eq("data_sharing_enabled", false);
  }

  const { data: profiles } = await profileQuery;
  if (!profiles) return NextResponse.json({ events: [], total: 0, profiles: [] });

  const profileMap: Record<string, typeof profiles[number]> = {};
  for (const p of profiles) profileMap[p.id] = p;

  const userIds = profiles.map((p) => p.id);
  if (userIds.length === 0) return NextResponse.json({ events: [], total: 0, profiles: [] });

  // Fetch events
  let eventsQuery = service
    .from("events")
    .select(
      "id, user_id, event_name, event_date, event_type, location, city, net_sales, fee_type, fee_rate, weather_type, anomaly_flag, event_tier, notes",
      { count: "exact" }
    )
    .in("user_id", userIds)
    .order("event_date", { ascending: false })
    .range(from, from + pageSize - 1);

  if (search) {
    eventsQuery = eventsQuery.ilike("event_name", `%${search}%`);
  }

  const { data: events, count } = await eventsQuery;

  const enriched = (events ?? []).map((e) => ({
    ...e,
    business_name: profileMap[e.user_id]?.business_name ?? "Unknown",
    business_city: profileMap[e.user_id]?.city ?? null,
    data_sharing_enabled: profileMap[e.user_id]?.data_sharing_enabled ?? true,
  }));

  return NextResponse.json({
    events: enriched,
    total: count ?? 0,
    profiles: profiles.map((p) => ({
      id: p.id,
      business_name: p.business_name,
      data_sharing_enabled: p.data_sharing_enabled,
    })),
  });
}
