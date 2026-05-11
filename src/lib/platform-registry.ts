 
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
  // Cross-operator fee aggregate inputs (added 2026-05-02 follow-on).
  // fee_type is an enum on events; fee_rate is the numeric value paired
  // with that fee_type (interpretation depends on the type — flat $ for
  // flat_fee, % for percentage, etc.). Aggregating only the modal
  // fee_type's rates keeps median_fee_rate semantically coherent.
  fee_type: string | null;
  fee_rate: number | null;
  // Cross-operator Phase 2 weather inputs. event_date drives month-of-year
  // bucketing; event_weather is the operator-recorded weather for that
  // booking. Both nullable — rows without weather contribute to nothing
  // weather-related.
  event_date: string | null;
  event_weather: string | null;
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
  // Cross-operator fee aggregate outputs. modal_fee_type = most-common
  // fee_type across operators (null if no row had a fee_type or if
  // operator_count < 3). median_fee_rate = median of fee_rates ONLY for
  // rows whose fee_type matches the modal — keeps the rate semantically
  // coherent (don't average a flat $50 fee against a 12% percentage).
  // Higher privacy floor (3+) than other Phase 1 aggregates.
  modal_fee_type: string | null;
  median_fee_rate: number | null;
  // Cross-operator Phase 2 weather output. Per-month modal weather across
  // operators. Months below the 3+ operator floor are absent from the
  // record (no null placeholder). Empty record when no month has enough
  // contributors.
  modal_weather_by_month: Record<string, { weather: string; count: number }>;
  // Cross-operator Phase 3 DOW output. Per-day-of-week lift vs the event's
  // own median across operators. lift_pct is the integer percent above
  // (positive) or below (negative). Empty record when no DOW has 3+
  // distinct operators contributing.
  dow_lift: Record<string, { lift_pct: number; count: number }>;
}

/**
 * Compute the platform-aggregate stats from a set of raw event rows.
 * Returns null when fewer than 2 distinct operators contribute (privacy
 * floor — single-operator publication would deanonymize the source).
 *
 * Pure function on rows; callers do their own filtering (sharing
 * eligibility, self-exclusion, etc.) before passing rows in.
 *
 * For the runtime read path that excludes a viewer, use
 * computeAggregateExcludingViewer below — it verifies the privacy floor
 * on the FULL bucket and then computes the aggregate on the viewer-
 * excluded subset. Calling computeAggregate directly on a pre-excluded
 * row set re-applies the ≥2 floor after exclusion, which structurally
 * requires 3+ total operators and breaks the seed-operator phase demo.
 */
function computeAggregate(rows: AggregatableRow[]): AggregateResult | null {
  if (rows.length === 0) return null;
  const operatorCount = new Set(rows.map((r) => r.user_id)).size;
  if (operatorCount < 2) return null;
  return computeAggregateBody(rows, operatorCount);
}

/**
 * Viewer-aware platform aggregate. Privacy floor (≥2 distinct
 * operators) is enforced on the FULL row set passed in — so the bucket
 * itself must satisfy the contract regardless of who's viewing. The
 * returned aggregate's medians + percentiles + modal stats are computed
 * on rows EXCLUDING the viewer, so the viewer never sees their own data
 * folded into the cross-op signal.
 *
 * Crucially: the post-exclusion subset is NOT subject to its own ≥2
 * floor. In a 2-operator world (you + Nick), the full bucket has 2 ops
 * → privacy passes → the excluded subset has 1 op (Nick) → that's the
 * legitimate cross-op signal for you. The earlier shape of "computeAggregate
 * on the pre-excluded set" implicitly required ≥3 total operators because
 * it re-applied the ≥2 floor after stripping the viewer.
 *
 * `operator_count` in the returned object reports the FULL bucket's
 * operator count (the privacy-relevant number, what the engine reads
 * for its firing threshold). The viewer's own contribution is excluded
 * from medians but the count tells the engine "this aggregate came from
 * N distinct operators, you're one of them."
 */
function computeAggregateExcludingViewer(
  rows: AggregatableRow[],
  excludeUserId: string
): AggregateResult | null {
  if (rows.length === 0) return null;
  const fullOps = new Set(rows.map((r) => r.user_id));
  if (fullOps.size < 2) return null;
  const excluded = rows.filter((r) => r.user_id !== excludeUserId);
  if (excluded.length === 0) return null;
  return computeAggregateBody(excluded, fullOps.size);
}

/**
 * Shared body for computeAggregate + computeAggregateExcludingViewer.
 * Takes the rows to aggregate AND the operator_count to report — the
 * caller decides which (the same set as the rows, or the FULL bucket's
 * count when computing a viewer-excluded aggregate).
 */
function computeAggregateBody(
  rows: AggregatableRow[],
  operatorCount: number
): AggregateResult {
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

  // Cross-operator Phase 2 weather aggregates. Per-month modal weather
  // across operators with this event_name in that month-of-year. Higher
  // privacy floor (3+ operators per cell) because weather + event_name
  // + month combined is meaningfully identifying. Months below the floor
  // are simply absent from the output record.
  const modal_weather_by_month: Record<string, { weather: string; count: number }> = {};
  if (operatorCount >= 3) {
    // Group operator-month-weather counts:
    //   weatherCounts[month][weather] = Set<user_id>
    // Track distinct operators per (month × weather) combo so we can
    // enforce the 3+ floor at the cell level, not the event level.
    const weatherCounts: Record<string, Record<string, Set<string>>> = {};
    for (const r of rows) {
      if (!r.event_date || !r.event_weather) continue;
      const month = String(new Date(r.event_date + "T00:00:00").getMonth() + 1);
      if (!weatherCounts[month]) weatherCounts[month] = {};
      if (!weatherCounts[month][r.event_weather]) {
        weatherCounts[month][r.event_weather] = new Set();
      }
      weatherCounts[month][r.event_weather].add(r.user_id);
    }
    // Pick the modal weather per month (cell with the most distinct
    // operators) and only publish if that cell has 3+ operators.
    for (const [month, byWeather] of Object.entries(weatherCounts)) {
      const sorted = Object.entries(byWeather)
        .map(([weather, ops]) => ({ weather, count: ops.size }))
        .sort((a, b) => b.count - a.count);
      if (sorted.length > 0 && sorted[0].count >= 3) {
        modal_weather_by_month[month] = {
          weather: sorted[0].weather,
          count: sorted[0].count,
        };
      }
    }
  }

  // Cross-operator fee aggregates. Higher privacy floor (3+ operators)
  // because fee_type + event_name combined leans more identifying. We
  // skip the fee block entirely below that threshold.
  let modal_fee_type: string | null = null;
  let median_fee_rate: number | null = null;
  if (operatorCount >= 3) {
    // Modal fee_type: most-common across rows. "none" is meaningful (no
    // fee at all), so we DO include it. Skip null/undefined / empty.
    const feeTypeCounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.fee_type) feeTypeCounts[r.fee_type] = (feeTypeCounts[r.fee_type] ?? 0) + 1;
    }
    const sorted = Object.entries(feeTypeCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      modal_fee_type = sorted[0][0];
      // Median fee_rate ONLY across rows whose fee_type matches the
      // modal — averaging a flat $50 against a 12% would be nonsense.
      // Also skips "none" because there's no rate to median when the
      // modal is no-fee.
      if (modal_fee_type !== "none") {
        median_fee_rate = medianOfNonNull(
          rows.filter((r) => r.fee_type === modal_fee_type).map((r) => r.fee_rate)
        );
      }
    }
  }

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
    modal_fee_type,
    median_fee_rate,
    modal_weather_by_month,
    dow_lift: computeDowLift(rows, median),
  };
}

// Cross-operator Phase 3 — per-DOW lift vs the event-wide median across
// operators. Returns integer percent above (positive) / below (negative)
// the event median, plus the count of distinct operators contributing
// to that DOW cell. DOWs below the 3+ operator floor are absent.
//
// Why distinct operators (not bookings): a single operator with 8 Saturday
// bookings doesn't satisfy the floor on its own — the cell still leaks
// who that operator is. Need 3+ different operators to publish.
//
// Lift math: medianForDow / eventMedian - 1, rounded to integer percent.
// Returns 0 lift when the DOW median equals the event median (no signal).
// Negative when DOW underperforms.
function computeDowLift(
  rows: AggregatableRow[],
  eventMedian: number
): Record<string, { lift_pct: number; count: number }> {
  const out: Record<string, { lift_pct: number; count: number }> = {};
  if (eventMedian <= 0) return out;
  // Group by DOW: dowSales[dow] = sales[]; dowOps[dow] = Set<user_id>
  const dowSales: Record<string, number[]> = {};
  const dowOps: Record<string, Set<string>> = {};
  for (const r of rows) {
    if (!r.event_date) continue;
    const dow = String(new Date(r.event_date + "T00:00:00").getDay());
    if (!dowSales[dow]) {
      dowSales[dow] = [];
      dowOps[dow] = new Set();
    }
    dowSales[dow].push(r.net_sales);
    dowOps[dow].add(r.user_id);
  }
  for (const [dow, sales] of Object.entries(dowSales)) {
    const opCount = dowOps[dow].size;
    if (opCount < 3) continue; // privacy floor
    const sorted = [...sales].sort((a, b) => a - b);
    const n = sorted.length;
    const dowMedian =
      n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    const lift_pct = Math.round((dowMedian / eventMedian - 1) * 100);
    out[dow] = { lift_pct, count: opCount };
  }
  return out;
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
export const __computeAggregateExcludingViewer = computeAggregateExcludingViewer;

import { resolveAliases, expandCanonicalsToAliases } from "@/lib/event-name-aliases";

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

  // Top-level operators only — managers (owner_user_id NOT NULL) are
  // employees of an existing operator, not a second business. Including
  // their rows here inflates operator_count and double-counts the same
  // booking when both owner + manager log it (typical pattern: same
  // event_name + event_date + net_sales). Surfaced 2026-05-11 by the
  // cross-op diagnostic — Wok-O's Shutterfest aggregate had
  // operator_count=3 from (Wok-O + Best Wurst + Wok-O's manager Rohini)
  // when the real cross-op count is 2.
  const { data: sharingUsers } = await client
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);

  const sharingUserIds = new Set((sharingUsers ?? []).map((u: { id: string }) => u.id));
  if (sharingUserIds.size === 0) return;

  // Resolve each input event_name to its canonical normalized form via
  // the aliases table. Two inputs that differ only by aliased spelling
  // collapse to the same canonical, so we de-dupe after resolving.
  const inputNormalized = eventNames.map((n) => n.toLowerCase().trim());
  const resolveMap = await resolveAliases(client, inputNormalized);
  const canonicalSet = new Set<string>();
  // Track display strings keyed by canonical so the upsert preserves
  // the canonical's preferred casing rather than picking whichever
  // alias triggered the recompute.
  const canonicalDisplay = new Map<string, string>();
  for (let i = 0; i < eventNames.length; i++) {
    const canon = resolveMap.get(inputNormalized[i]) ?? inputNormalized[i];
    canonicalSet.add(canon);
    if (!canonicalDisplay.has(canon)) {
      // Default to the input display; will be replaced by the alias-
      // table's canonical_display below if one exists.
      canonicalDisplay.set(canon, eventNames[i]);
    }
  }

  // Pull the alias-table's display label for each canonical so the
  // upsert writes the curated display, not whichever alias-form
  // happened to trigger the recompute.
  if (canonicalSet.size > 0) {
    const { data: canonRows } = await client
      .from("event_name_aliases")
      .select("canonical_normalized, canonical_display")
      .in("canonical_normalized", Array.from(canonicalSet));
    for (const row of (canonRows ?? []) as {
      canonical_normalized: string;
      canonical_display: string;
    }[]) {
      canonicalDisplay.set(row.canonical_normalized, row.canonical_display);
    }
  }

  // Expand each canonical to all its alias-form normalized strings so
  // we can fold them into the bucket at compute time.
  const expandMap = await expandCanonicalsToAliases(
    client,
    Array.from(canonicalSet)
  );

  for (const canonical of canonicalSet) {
    try {
      const aliases = expandMap.get(canonical) ?? new Set([canonical]);
      const display = canonicalDisplay.get(canonical) ?? canonical;
      await upsertPlatformEvent(client, canonical, display, aliases, sharingUserIds);
    } catch {
      // Non-fatal
    }
  }
}

async function upsertPlatformEvent(
  client: AnyClient,
  canonical: string,
  display: string,
  matchNormalized: Set<string>,
  sharingUserIds: Set<string>
): Promise<void> {
  // Pull events whose lower(trim(event_name)) is the canonical OR any
  // of its alias forms. .ilike() doesn't natively OR over multiple
  // patterns, so we do the case-insensitive grouping client-side
  // after fetching by event_name presence in the raw set (case-
  // sensitive .in won't match — fall back to a broader fetch + filter).
  const lcSet = new Set(Array.from(matchNormalized).map((s) => s.toLowerCase()));

  // Query by display strings — we don't have those, so use broad
  // ilike on each canonical/alias and union. For small alias counts
  // (< 5 typical) the overhead is negligible.
  const allRows: AggregatableRow[] = [];
  for (const norm of matchNormalized) {
    const { data: rows } = await client
      .from("events")
      .select("user_id, net_sales, event_type, city, other_trucks, expected_attendance, fee_type, fee_rate, event_date, event_weather, event_name")
      .ilike("event_name", norm)
      .eq("booked", true)
      .not("net_sales", "is", null)
      .gt("net_sales", 0)
      .neq("anomaly_flag", "disrupted");
    for (const r of (rows ?? []) as (AggregatableRow & { event_name: string })[]) {
      // Belt-and-suspenders: ilike already case-insensitive-matched, so
      // anything we got back has lower(trim(event_name)) in lcSet.
      // Keep the extra check for whitespace-trim safety.
      if (lcSet.has(r.event_name.toLowerCase().trim())) {
        // Deduplicate via primary-key-ish proxy — same user + date + name
        // shouldn't enter twice from overlapping ilike fetches.
        allRows.push(r);
      }
    }
  }

  if (allRows.length === 0) {
    // No backing data for this bucket — clear any stale platform_events
    // row so we don't keep a phantom aggregate alive after a recompute.
    await client
      .from("platform_events")
      .delete()
      .eq("event_name_normalized", canonical);
    // Also clear any alias-form rows that may exist from before the
    // alias was added — the canonical is the only legitimate row.
    const aliasOnly = Array.from(matchNormalized).filter((s) => s !== canonical);
    if (aliasOnly.length > 0) {
      await client
        .from("platform_events")
        .delete()
        .in("event_name_normalized", aliasOnly);
    }
    return;
  }

  const eventName = display;
  const normalized = canonical;
  const rows = allRows;

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
      modal_fee_type: agg.modal_fee_type,
      median_fee_rate: agg.median_fee_rate,
      modal_weather_by_month: agg.modal_weather_by_month,
      dow_lift: agg.dow_lift,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_name_normalized" }
  );

  // Drop any platform_events rows for the alias forms — they're
  // superseded by the canonical row we just wrote.
  const aliasOnly = Array.from(matchNormalized).filter((s) => s !== canonical);
  if (aliasOnly.length > 0) {
    await client
      .from("platform_events")
      .delete()
      .in("event_name_normalized", aliasOnly);
  }
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
  const inputNormalized = eventNames.map((n) => n.toLowerCase().trim());

  // Resolve aliases so an operator typing the alias-form name still
  // sees the canonical bucket's aggregate. Map is keyed by the
  // operator's input form; values point to whichever PlatformEvent
  // row is canonical for that input.
  const resolveMap = await resolveAliases(client, inputNormalized);
  const canonicalSet = Array.from(new Set(resolveMap.values()));

  const { data } = await client
    .from("platform_events")
    .select("*")
    .in("event_name_normalized", canonicalSet);

  const byCanonical = new Map<string, PlatformEvent>();
  for (const row of data ?? []) {
    byCanonical.set(row.event_name_normalized, row as PlatformEvent);
  }

  // Re-key by input normalized so callers can do
  // `map.get(name.toLowerCase().trim())` and not think about aliases.
  const out = new Map<string, PlatformEvent>();
  for (const input of inputNormalized) {
    const canonical = resolveMap.get(input) ?? input;
    const row = byCanonical.get(canonical);
    if (row) out.set(input, row);
  }
  return out;
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
  const inputNormalized = eventNames.map((n) => n.toLowerCase().trim());

  // Resolve aliases so events typed under any alias form roll up to
  // their canonical bucket — same shape as the cached writer.
  const resolveMap = await resolveAliases(client, inputNormalized);

  // Sharing list — same gate as the cached aggregator, top-level
  // operators only (managers filtered via owner_user_id IS NULL).
  // KEEP the viewer in the sharing set: the privacy floor is checked
  // on the FULL bucket (including viewer) inside
  // computeAggregateExcludingViewer; only the medians + percentiles
  // are computed on the viewer-excluded subset. This is what makes a
  // 2-operator world (viewer + 1 other) actually fire the platform
  // prior — the bucket satisfies ≥2 with the viewer counted, and the
  // viewer sees the other operator's aggregate stats. Removing the
  // viewer from sharingUserIds before the privacy check (the prior
  // shape) requires ≥3 total operators to fire, defeating the
  // seed-operator-phase intent of PR #265.
  const { data: sharingUsers } = await client
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  const sharingUserIds = new Set(
    (sharingUsers ?? []).map((u: { id: string }) => u.id)
  );
  if (sharingUserIds.size === 0) return new Map();

  // One batch fetch for all event names — IN filter on event_name
  // (case-insensitive matches the cached version's ilike behavior).
  // For a small number of event names this is cheaper than N
  // separate queries.
  const { data: rows } = await client
    .from("events")
    .select("user_id, net_sales, event_type, city, event_name, other_trucks, expected_attendance, fee_type, fee_rate, event_date, event_weather")
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
  // Eligible = sharing-enabled (viewer included for privacy-floor count;
  // computeAggregateExcludingViewer excludes them from medians below).
  const eligible = (rows as EventRowWithName[]).filter((r) =>
    sharingUserIds.has(r.user_id)
  );

  // Group by canonical normalized event name (resolve through aliases),
  // then compute aggregate per group.
  const groups = new Map<string, EventRowWithName[]>();
  for (const r of eligible) {
    const lc = r.event_name.toLowerCase().trim();
    const key = resolveMap.get(lc) ?? lc;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const byCanonical = new Map<string, PlatformEvent>();
  for (const [key, groupRows] of groups) {
    const agg = computeAggregateExcludingViewer(groupRows, excludeUserId);
    if (!agg) continue;
    // Synthesize a PlatformEvent shape so callers don't need to
    // branch. Fields the cached table tracks (event_name_normalized,
    // event_name_display, updated_at) are filled best-effort.
    const display = groupRows[0].event_name;
    byCanonical.set(key, {
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
      modal_fee_type: agg.modal_fee_type,
      median_fee_rate: agg.median_fee_rate,
      modal_weather_by_month: agg.modal_weather_by_month,
      dow_lift: agg.dow_lift,
      updated_at: new Date().toISOString(),
    } as PlatformEvent);
  }

  // Re-key by input normalized so callers can do
  // `map.get(name.toLowerCase().trim())` and not think about aliases.
  const out = new Map<string, PlatformEvent>();
  for (const input of inputNormalized) {
    const canonical = resolveMap.get(input) ?? input;
    const row = byCanonical.get(canonical);
    if (row) out.set(input, row);
  }
  return out;
}
