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

interface AggregatableRow {
  user_id: string;
  net_sales: number;
  event_type: string | null;
  city: string | null;
  // Cross-operator Phase 1 inputs (added 2026-05-02). Both nullable in
  // source events; aggregates only computed when at least one row of
  // the contributing set has a value.
  other_trucks: number | null;
  expected_attendance: number | null;
}

interface AggregateResult {
  operator_count: number;
  total_instances: number;
  avg_sales: number;
  median_sales: number;
  min_sales: number;
  max_sales: number;
  sales_p25: number;
  sales_p75: number;
  most_common_event_type: string | null;
  most_common_city: string | null;
  // Cross-operator Phase 1 outputs. Null when the contributing rows
  // had no values for the underlying field — recompute leaves the
  // platform_events column null in that case so display can fall
  // through cleanly.
  median_other_trucks: number | null;
  median_attendance: number | null;
}

/**
 * Compute the platform-aggregate stats from a set of raw event rows.
 * Returns null when fewer than 2 distinct operators contribute (privacy
 * floor — single-operator publication would deanonymize the source).
 *
 * Pure function on rows; callers do their own filtering (sharing
 * eligibility, self-exclusion, etc.) before passing rows in.
 */
function computeAggregate(rows: AggregatableRow[]): AggregateResult | null {
  if (rows.length === 0) return null;
  const operatorCount = new Set(rows.map((r) => r.user_id)).size;
  if (operatorCount < 2) return null;

  const sales = rows.map((r) => r.net_sales).sort((a, b) => a - b);
  const n = sales.length;
  const avg = sales.reduce((a, b) => a + b, 0) / n;
  const median =
    n % 2 === 0 ? (sales[n / 2 - 1] + sales[n / 2]) / 2 : sales[Math.floor(n / 2)];
  const p25 = sales[Math.max(0, Math.floor(n * 0.25) - 1)];
  const p75 = sales[Math.min(n - 1, Math.floor(n * 0.75))];

  const typeCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.event_type) typeCounts[r.event_type] = (typeCounts[r.event_type] ?? 0) + 1;
    if (r.city) cityCounts[r.city] = (cityCounts[r.city] ?? 0) + 1;
  }
  const mostCommonEventType =
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mostCommonCity =
    Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Cross-operator Phase 1 medians. Compute each independently — an
  // event might have other_trucks data but no attendance estimates
  // (or vice-versa). Return null when no contributing row had a
  // numeric value so display fall-through stays clean.
  const median_other_trucks = medianOfNonNull(
    rows.map((r) => r.other_trucks)
  );
  const median_attendance = medianOfNonNull(
    rows.map((r) => r.expected_attendance)
  );

  return {
    operator_count: operatorCount,
    total_instances: n,
    avg_sales: Math.round(avg * 100) / 100,
    median_sales: Math.round(median * 100) / 100,
    min_sales: sales[0],
    max_sales: sales[n - 1],
    sales_p25: Math.round(p25 * 100) / 100,
    sales_p75: Math.round(p75 * 100) / 100,
    most_common_event_type: mostCommonEventType,
    most_common_city: mostCommonCity,
    median_other_trucks,
    median_attendance,
  };
}

// Median of the non-null entries, rounded to 2 decimals. Returns null
// when nothing contributed. Shared by both Phase 1 aggregates so
// rounding + null handling stays in one place.
function medianOfNonNull(values: (number | null | undefined)[]): number | null {
  const filtered = values
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  const n = filtered.length;
  if (n === 0) return null;
  const m =
    n % 2 === 0 ? (filtered[n / 2 - 1] + filtered[n / 2]) / 2 : filtered[Math.floor(n / 2)];
  return Math.round(m * 100) / 100;
}

// Exported for tests.
export const __computeAggregate = computeAggregate;

/**
 * Updates the platform_events registry for the given event names.
 * Only includes data from users with data_sharing_enabled = true.
 * Minimum 2 distinct operators required to publish an aggregate
 * (privacy floor).
 *
 * The aggregate stored here represents the platform-wide truth — it
 * INCLUDES every sharing user. Display-time consumers (forecast
 * engine call sites) should use getPlatformEventsExcludingUser()
 * instead, which recomputes the aggregate excluding the requesting
 * operator so the operator never sees a blend that's regressing
 * toward their own mean.
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
    .select("user_id, net_sales, event_type, city, other_trucks, expected_attendance")
    .ilike("event_name", normalized)
    .eq("booked", true)
    .not("net_sales", "is", null)
    .gt("net_sales", 0)
    .neq("anomaly_flag", "disrupted");

  if (!rows || rows.length === 0) return;

  const eligible = (rows as AggregatableRow[]).filter((r) =>
    sharingUserIds.has(r.user_id)
  );
  const agg = computeAggregate(eligible);
  if (!agg) return;

  await client.from("platform_events").upsert(
    {
      event_name_normalized: normalized,
      event_name_display: eventName,
      operator_count: agg.operator_count,
      total_instances: agg.total_instances,
      avg_sales: agg.avg_sales,
      median_sales: agg.median_sales,
      min_sales: agg.min_sales,
      max_sales: agg.max_sales,
      sales_p25: agg.sales_p25,
      sales_p75: agg.sales_p75,
      most_common_event_type: agg.most_common_event_type,
      most_common_city: agg.most_common_city,
      median_other_trucks: agg.median_other_trucks,
      median_attendance: agg.median_attendance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_name_normalized" }
  );
}

/**
 * Fetch platform event aggregates for a list of event names from the
 * cached platform_events table. Returns the platform-wide aggregate
 * INCLUDING all sharing operators.
 *
 * Use this for admin/data views. For forecast-engine display, prefer
 * getPlatformEventsExcludingUser() — including self in the median is
 * a regression-toward-self artifact that distorts forecasts at small
 * platform scale.
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
  for (const row of data ?? []) {
    map.set(row.event_name_normalized, row as PlatformEvent);
  }
  return map;
}

/**
 * Same shape as getPlatformEvents() but recomputes each aggregate
 * fresh from the events table, excluding the requesting operator's
 * own bookings. This is the right helper for the forecast engine
 * call sites (operator-notes Q2, 2026-04-29):
 *
 *   - Q2 root cause: getPlatformEvents() reads cached aggregates that
 *     INCLUDE the requesting operator's data. When the engine blends
 *     forecast = personal_weight × personal_mean + (1 - personal_weight)
 *     × platform_median, the platform_median is partially
 *     regressing toward the operator's own mean. At 2-operator
 *     platform scale this is a real distortion; once we have 10+
 *     operators it's noise.
 *
 *   - Fix shape: requery events fresh per request, filter to sharing
 *     operators, exclude the requesting userId, compute aggregate.
 *     The privacy floor (operator_count >= 2) now applies to OTHER
 *     operators only — i.e. need 2+ peers besides self for a blend
 *     to surface.
 *
 *   - Cost: one extra query per dashboard render. For typical operator
 *     load (a few dozen unique event names per dashboard) the extra
 *     query is fast. Skip the cache entirely for this consumer.
 */
export async function getPlatformEventsExcludingUser(
  eventNames: string[],
  excludeUserId: string
): Promise<Map<string, PlatformEvent>> {
  if (eventNames.length === 0) return new Map();
  const client = getServiceClient();
  const normalized = eventNames.map((n) => n.toLowerCase().trim());

  // Sharing list — same gate as the cached aggregator. We don't need
  // to recompute this per event; one fetch covers all.
  const { data: sharingUsers } = await client
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true);
  const sharingUserIds = new Set(
    (sharingUsers ?? []).map((u: { id: string }) => u.id)
  );
  // The requesting user is excluded regardless of their own
  // data_sharing_enabled flag — the goal is to show "what others
  // see," not "what the platform recorded."
  sharingUserIds.delete(excludeUserId);
  if (sharingUserIds.size === 0) return new Map();

  // One batch fetch for all event names — IN filter on event_name
  // (case-insensitive matches the cached version's ilike behavior).
  // For a small number of event names this is cheaper than N
  // separate queries.
  const { data: rows } = await client
    .from("events")
    .select("user_id, net_sales, event_type, city, event_name, other_trucks, expected_attendance")
    .in(
      "event_name",
      // Use the original casing the operator stored — ilike below
      // also matches against normalized casing on subsequent groups.
      eventNames
    )
    .eq("booked", true)
    .not("net_sales", "is", null)
    .gt("net_sales", 0)
    .neq("anomaly_flag", "disrupted");

  if (!rows) return new Map();

  type EventRowWithName = AggregatableRow & { event_name: string };
  const eligible = (rows as EventRowWithName[]).filter(
    (r) => r.user_id !== excludeUserId && sharingUserIds.has(r.user_id)
  );

  // Group by normalized event name, then compute aggregate per group.
  const groups = new Map<string, EventRowWithName[]>();
  for (const r of eligible) {
    const key = r.event_name.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const out = new Map<string, PlatformEvent>();
  for (const [key, groupRows] of groups) {
    const agg = computeAggregate(groupRows);
    if (!agg) continue;
    // Synthesize a PlatformEvent shape so callers don't need to
    // branch. Fields the cached table tracks (event_name_normalized,
    // event_name_display, updated_at) are filled best-effort.
    const display = groupRows[0].event_name;
    out.set(key, {
      event_name_normalized: key,
      event_name_display: display,
      operator_count: agg.operator_count,
      total_instances: agg.total_instances,
      avg_sales: agg.avg_sales,
      median_sales: agg.median_sales,
      min_sales: agg.min_sales,
      max_sales: agg.max_sales,
      sales_p25: agg.sales_p25,
      sales_p75: agg.sales_p75,
      most_common_event_type: agg.most_common_event_type,
      most_common_city: agg.most_common_city,
      median_other_trucks: agg.median_other_trucks,
      median_attendance: agg.median_attendance,
      updated_at: new Date().toISOString(),
    } as PlatformEvent);
  }
  return out;
}
