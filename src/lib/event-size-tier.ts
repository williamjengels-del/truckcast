/**
 * Event size tier — operator-tagged "is this a big or small night?".
 *
 * Foundation for the major-event-tag workstream. The engine partitions
 * the per-event-name posterior by tier so flagship nights aren't
 * averaged with typical nights at the same venue. See
 * Briefs/vendcast_scoping_event-size-tier_2026-05-08.md for the design
 * rationale and 4-PR breakdown.
 *
 * Pure functions only — no I/O, no Supabase. inferTier and
 * effectiveTier are unit-testable and used from both the recalc path
 * (writes inferred) and the engine (reads effective).
 */

import type { Event } from "./database.types";

/** Four-bucket size scale for events. SMALL/NORMAL/LARGE/FLAGSHIP
 *  chosen for operator legibility (TIER_1..TIER_4 was considered and
 *  rejected — labels need to mean something at a glance). */
export type EventSizeTier = "SMALL" | "NORMAL" | "LARGE" | "FLAGSHIP";

/** Bucket boundaries — ratio of event's actual revenue to the operator's
 *  median for the same event_name (12-month rolling window). Tuned to
 *  produce roughly balanced buckets across Wok-O Taco's 384-event
 *  history; revisit empirically if cluster sizes drift. */
export const TIER_THRESHOLDS = {
  /** ratio ≤ this → SMALL */
  small: 0.5,
  /** ratio > small AND ratio ≤ large → NORMAL */
  large: 2.0,
  /** ratio > large AND ratio ≤ flagship → LARGE */
  flagship: 4.0,
  /** ratio > flagship → FLAGSHIP */
} as const;

/**
 * Infer a tier from an event's actual revenue and its venue's typical
 * revenue (operator's median for the same event_name).
 *
 * Returns null when there's no usable baseline:
 *   - venueMedian is null/zero (no history yet, or venue unknown)
 *   - actualRevenue is null/zero (event hasn't happened or wasn't tracked)
 * In both cases the engine treats the event as NORMAL via effectiveTier
 * — null specifically means "no signal," not "definitely NORMAL."
 *
 * Returns SMALL when actualRevenue is unusually low for the venue
 * (≤ 0.5× venue median), FLAGSHIP when unusually high (> 4× median).
 */
export function inferTier(
  actualRevenue: number | null | undefined,
  venueMedian: number | null | undefined
): EventSizeTier | null {
  if (
    actualRevenue == null ||
    actualRevenue <= 0 ||
    venueMedian == null ||
    venueMedian <= 0
  ) {
    return null;
  }
  const ratio = actualRevenue / venueMedian;
  if (ratio <= TIER_THRESHOLDS.small) return "SMALL";
  if (ratio <= TIER_THRESHOLDS.large) return "NORMAL";
  if (ratio <= TIER_THRESHOLDS.flagship) return "LARGE";
  return "FLAGSHIP";
}

/**
 * Resolve the effective tier for an event, applying the precedence
 * rule: operator override wins, then inferred, then NORMAL default.
 *
 * Defaulting to NORMAL (rather than null) keeps the engine's partition
 * logic simple — every event has a tier, no null-handling branches in
 * the hot path. Operator can always override if NORMAL is wrong for an
 * event without history.
 */
export function effectiveTier(
  event: Pick<Event, "event_size_tier_operator" | "event_size_tier_inferred">
): EventSizeTier {
  const operator = normalizeTier(event.event_size_tier_operator);
  if (operator) return operator;
  const inferred = normalizeTier(event.event_size_tier_inferred);
  if (inferred) return inferred;
  return "NORMAL";
}

/** Type-guard / normalizer. Accepts the loose string types from the
 *  DB (TEXT + CHECK constraint) and narrows to EventSizeTier. Returns
 *  null for unknown values rather than throwing — defensive against
 *  manually-edited rows. */
function normalizeTier(raw: string | null | undefined): EventSizeTier | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "SMALL" || upper === "NORMAL" || upper === "LARGE" || upper === "FLAGSHIP") {
    return upper;
  }
  return null;
}

/**
 * Compute per-event-name venue medians from a set of events. The median
 * is over eventRevenue (net_sales for food trucks, invoice_revenue for
 * catering) of past events with actuals at the same event_name.
 *
 * **Population median** — INCLUDES every eligible event in its venue.
 * For per-event tier inference where the event being tiered shouldn't
 * count toward its own baseline, use `computeLooVenueMediansPerEvent`
 * instead. This function is retained for diagnostic and aggregate use
 * (e.g. operator-facing "what's a typical Music Park night look like
 * right now" answers).
 *
 * **All-history**, NOT a rolling window. The 2026-05-08 first-recalc
 * audit found that a 12-month window left 215 of 384 past events with
 * no usable median (their event_name had no peer within the year). Tier
 * is fundamentally a relative-to-venue classification — coverage beats
 * recency at this layer. Engine partition (PR 3) can decide whether
 * downstream forecasting should weight recent events more heavily.
 *
 * Excludes disrupted / boosted events (their revenue isn't
 * representative of the venue's typical draw).
 *
 * Returns a map keyed by event_name (lowercased + trimmed) → median.
 * Empty map when no eligible events.
 */
export function computeVenueMediansForTierInference(
  events: Pick<Event, "event_name" | "event_date" | "net_sales" | "invoice_revenue" | "event_mode" | "anomaly_flag">[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Map<string, number> {
  const sortedByName = collectSortedRevenuesPerVenue(events, asOfDate);
  const medians = new Map<string, number>();
  for (const [key, sorted] of sortedByName) {
    if (sorted.length === 0) continue;
    medians.set(key, medianOfSorted(sorted));
  }
  return medians;
}

/**
 * Per-event leave-one-out venue median. For each eligible event,
 * returns the median of OTHER events at the same venue, excluding the
 * event itself. Use this for tier inference so an event isn't biased
 * toward NORMAL by its own contribution to the venue baseline.
 *
 * Why LOO matters: if a venue has 5 events at $500/$600/$800/$1000/$2836,
 * the population median is $800, ratio for the $2836 night = 3.55 → LARGE.
 * Excluding the event from its own baseline: median of [$500,$600,$800,$1000]
 * is $700, ratio = 4.05 → FLAGSHIP. The all-population approach systematically
 * under-classifies extremes by letting them pull the median toward themselves.
 *
 * Returns null for events with no peer (n=1 at this venue) — there's no
 * baseline to compare against. Caller's `inferTier(...)` returns null in
 * that case, surfacing as untiered (effectiveTier defaults to NORMAL).
 *
 * Same all-history + anomaly-flag filtering as
 * `computeVenueMediansForTierInference`.
 *
 * Returns a Map keyed by event ID → LOO median (or null).
 */
export function computeLooVenueMediansPerEvent(
  events: Pick<Event, "id" | "event_name" | "event_date" | "net_sales" | "invoice_revenue" | "event_mode" | "anomaly_flag">[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Map<string, number | null> {
  // First pass: group eligible revenues per venue-name in event order
  // so we can index back into them by event_id.
  const byName = new Map<string, { id: string; revenue: number }[]>();
  for (const e of events) {
    if (e.event_date > asOfDate) continue;
    if (e.anomaly_flag === "disrupted" || e.anomaly_flag === "boosted") continue;
    const revenue =
      e.event_mode === "catering"
        ? e.invoice_revenue ?? 0
        : e.net_sales ?? 0;
    if (revenue <= 0) continue;
    const key = e.event_name.toLowerCase().trim();
    if (!key) continue;
    const arr = byName.get(key) ?? [];
    arr.push({ id: e.id, revenue });
    byName.set(key, arr);
  }

  const result = new Map<string, number | null>();
  for (const [, entries] of byName) {
    if (entries.length < 2) {
      // n=1: no peer. Mark as null so callers don't infer tier from
      // self-comparison (which would always yield ratio = 1.0 = NORMAL).
      for (const e of entries) result.set(e.id, null);
      continue;
    }
    // Sort by revenue once.
    const sortedRevenues = entries.map((e) => e.revenue).sort((a, b) => a - b);
    for (const e of entries) {
      // Splice the event's own revenue out (first matching value — ties
      // are fine because every removal pattern produces the same
      // n-1 distribution downstream).
      const removeAt = sortedRevenues.indexOf(e.revenue);
      const peers =
        removeAt < 0
          ? sortedRevenues.slice()
          : [...sortedRevenues.slice(0, removeAt), ...sortedRevenues.slice(removeAt + 1)];
      result.set(e.id, peers.length === 0 ? null : medianOfSorted(peers));
    }
  }
  return result;
}

/** Internal helper — group eligible revenues per venue-name (sorted asc). */
function collectSortedRevenuesPerVenue(
  events: Pick<Event, "event_name" | "event_date" | "net_sales" | "invoice_revenue" | "event_mode" | "anomaly_flag">[],
  asOfDate: string
): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  for (const e of events) {
    if (e.event_date > asOfDate) continue;
    if (e.anomaly_flag === "disrupted" || e.anomaly_flag === "boosted") continue;
    const revenue =
      e.event_mode === "catering"
        ? e.invoice_revenue ?? 0
        : e.net_sales ?? 0;
    if (revenue <= 0) continue;
    const key = e.event_name.toLowerCase().trim();
    if (!key) continue;
    const arr = byName.get(key) ?? [];
    arr.push(revenue);
    byName.set(key, arr);
  }
  for (const [k, v] of byName) byName.set(k, v.sort((a, b) => a - b));
  return byName;
}

/** Internal helper — median of a pre-sorted array. */
function medianOfSorted(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
