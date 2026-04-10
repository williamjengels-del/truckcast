// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient as createServiceClient, SupabaseClient } from "@supabase/supabase-js";
import type { PlatformEvent } from "@/lib/database.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

function getServiceClient(): AnyClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as AnyClient;
}

/**
 * Updates the platform_events registry for the given event names.
 * Only includes data from users with data_sharing_enabled = true.
 * Minimum 2 distinct operators required to publish an aggregate (privacy floor).
 */
export async function updatePlatformRegistry(eventNames: string[]): Promise<void> {
  if (eventNames.length === 0) return;
  const client = getServiceClient();

  const { data: sharingUsers } = await client
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true);

  const sharingUserIds = new Set((sharingUsers ?? []).map((u: { id: string }) => u.id));
  if (sharingUserIds.size === 0) return;

  for (const eventName of eventNames) {
    try {
      await upsertPlatformEvent(client, eventName, sharingUserIds);
    } catch {
      // Non-fatal
    }
  }
}

async function upsertPlatformEvent(
  client: AnyClient,
  eventName: string,
  sharingUserIds: Set<string>
): Promise<void> {
  const normalized = eventName.toLowerCase().trim();

  const { data: rows } = await client
    .from("events")
    .select("user_id, net_sales, event_type, city")
    .ilike("event_name", normalized)
    .eq("booked", true)
    .not("net_sales", "is", null)
    .gt("net_sales", 0)
    .neq("anomaly_flag", "disrupted");

  if (!rows || rows.length === 0) return;

  type EventRow = { user_id: string; net_sales: number; event_type: string | null; city: string | null };
  const eligible = (rows as EventRow[]).filter((r) => sharingUserIds.has(r.user_id));
  if (eligible.length === 0) return;

  const operatorCount = new Set(eligible.map((r) => r.user_id)).size;
  if (operatorCount < 2) return; // Privacy floor: need 2+ operators

  const sales: number[] = eligible
    .map((r) => r.net_sales)
    .sort((a, b) => a - b);
  const n = sales.length;
  const avg = sales.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0
    ? (sales[n / 2 - 1] + sales[n / 2]) / 2
    : sales[Math.floor(n / 2)];
  const p25 = sales[Math.max(0, Math.floor(n * 0.25) - 1)];
  const p75 = sales[Math.min(n - 1, Math.floor(n * 0.75))];

  const typeCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  for (const r of eligible) {
    if (r.event_type) typeCounts[r.event_type] = (typeCounts[r.event_type] ?? 0) + 1;
    if (r.city) cityCounts[r.city] = (cityCounts[r.city] ?? 0) + 1;
  }
  const mostCommonType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mostCommonCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  await client.from("platform_events").upsert({
    event_name_normalized: normalized,
    event_name_display: eventName,
    operator_count: operatorCount,
    total_instances: n,
    avg_sales: Math.round(avg * 100) / 100,
    median_sales: Math.round(median * 100) / 100,
    min_sales: sales[0],
    max_sales: sales[n - 1],
    sales_p25: Math.round(p25 * 100) / 100,
    sales_p75: Math.round(p75 * 100) / 100,
    most_common_event_type: mostCommonType,
    most_common_city: mostCommonCity,
    updated_at: new Date().toISOString(),
  }, { onConflict: "event_name_normalized" });
}

/**
 * Fetch platform event aggregates for a list of event names.
 * Returns a Map from normalized event name -> PlatformEvent.
 */
export async function getPlatformEvents(
  eventNames: string[]
): Promise<Map<string, PlatformEvent>> {
  if (eventNames.length === 0) return new Map();
  const client = getServiceClient();
  const normalized = eventNames.map((n) => n.toLowerCase().trim());

  const { data } = await client
    .from("platform_events")
    .select("*")
    .in("event_name_normalized", normalized);

  const map = new Map<string, PlatformEvent>();
  for (const row of (data ?? [])) {
    map.set(row.event_name_normalized, row as PlatformEvent);
  }
  return map;
}
