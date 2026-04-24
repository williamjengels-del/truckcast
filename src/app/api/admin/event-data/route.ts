import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type SortField = "business" | "city" | "event_date" | "net_sales";
type SortDir = "asc" | "desc";

export async function GET(req: NextRequest) {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = getServiceClient();

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const pageSize = 50;
  const filterSharing = searchParams.get("sharing");
  const search = searchParams.get("q") ?? "";
  const businessSearch = searchParams.get("business") ?? "";
  const filterEventType = searchParams.get("event_type") ?? "";
  const filterBooked = searchParams.get("booked") ?? "";
  const sortField = (searchParams.get("sort") ?? "business") as SortField;
  const sortDir = (searchParams.get("dir") ?? "asc") as SortDir;

  // Fetch profiles
  let profileQuery = service
    .from("profiles")
    .select("id, business_name, city, state, data_sharing_enabled");

  if (filterSharing === "opted_in") {
    profileQuery = profileQuery.eq("data_sharing_enabled", true);
  } else if (filterSharing === "opted_out") {
    profileQuery = profileQuery.eq("data_sharing_enabled", false);
  }
  if (businessSearch) {
    profileQuery = profileQuery.ilike("business_name", `%${businessSearch}%`);
  }

  const { data: profiles } = await profileQuery;
  if (!profiles) return NextResponse.json({ events: [], total: 0, profiles: [] });

  const profileMap: Record<string, typeof profiles[number]> = {};
  for (const p of profiles) profileMap[p.id] = p;

  const userIds = profiles.map((p) => p.id);
  if (userIds.length === 0) return NextResponse.json({ events: [], total: 0, profiles: [] });

  // Fetch ALL matching events. PostgREST's default row limit is 1000 —
  // without explicit range or batching, larger result sets truncate
  // silently and the admin "total events" number becomes a ceiling, not
  // a count. We need everything in memory to apply the enrichment-
  // dependent sort (business name, city come from the joined profiles
  // map), so we page through in batches until exhaustion.
  function buildEventsQuery() {
    let q = service
      .from("events")
      .select("id, user_id, event_name, event_date, event_type, location, city, net_sales, fee_type, fee_rate, event_weather, anomaly_flag, event_tier, notes, booked, expected_attendance")
      .in("user_id", userIds);
    if (search) q = q.ilike("event_name", `%${search}%`);
    if (filterEventType) q = q.eq("event_type", filterEventType);
    if (filterBooked === "booked") q = q.eq("booked", true);
    else if (filterBooked === "unbooked") q = q.eq("booked", false);
    return q;
  }

  type EventRow = Awaited<ReturnType<ReturnType<typeof buildEventsQuery>["throwOnError"]>>["data"][number];
  const BATCH_SIZE = 1000;
  const allEvents: EventRow[] = [];
  let offset = 0;
  while (true) {
    const { data: batch, error: batchErr } = await buildEventsQuery()
      .order("event_date", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    if (batchErr) {
      console.error("[admin/event-data] batch fetch failed:", batchErr);
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }
    if (!batch || batch.length === 0) break;
    allEvents.push(...(batch as EventRow[]));
    if (batch.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  const events = allEvents;

  // Enrich with profile data
  const enriched = (events ?? []).map((e) => ({
    ...e,
    weather_type: e.event_weather,
    business_name: profileMap[e.user_id]?.business_name ?? "Unknown",
    business_city: profileMap[e.user_id]?.city ?? null,
    data_sharing_enabled: profileMap[e.user_id]?.data_sharing_enabled ?? true,
    booked: e.booked ?? null,
    expected_attendance: e.expected_attendance ?? null,
  }));

  // Sort — primary sort by chosen field, secondary always city then business then date
  const dir = sortDir === "asc" ? 1 : -1;
  enriched.sort((a, b) => {
    const str = (v: string | null | undefined) => (v ?? "").toLowerCase();
    const num = (v: number | null | undefined) => v ?? 0;

    let primary = 0;
    if (sortField === "business") {
      primary = str(a.business_name).localeCompare(str(b.business_name));
    } else if (sortField === "city") {
      primary = str(a.city ?? a.business_city).localeCompare(str(b.city ?? b.business_city));
    } else if (sortField === "event_date") {
      primary = str(a.event_date).localeCompare(str(b.event_date));
    } else if (sortField === "net_sales") {
      primary = num(a.net_sales) - num(b.net_sales);
    }

    if (primary !== 0) return primary * dir;

    // Secondary: city then business then date desc
    const cityDiff = str(a.city ?? a.business_city).localeCompare(str(b.city ?? b.business_city));
    if (cityDiff !== 0) return cityDiff;
    const bizDiff = str(a.business_name).localeCompare(str(b.business_name));
    if (bizDiff !== 0) return bizDiff;
    return str(b.event_date).localeCompare(str(a.event_date));
  });

  // Paginate after sort
  const total = enriched.length;
  const from = (page - 1) * pageSize;
  const paginated = enriched.slice(from, from + pageSize);

  return NextResponse.json({
    events: paginated,
    total,
    profiles: profiles.map((p) => ({
      id: p.id,
      business_name: p.business_name,
      data_sharing_enabled: p.data_sharing_enabled,
    })),
  });
}
