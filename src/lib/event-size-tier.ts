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
 * Compute per-event-name venue medians from a set of events. Used by
 * recalc to populate event_size_tier_inferred. The median is over
 * eventRevenue (net_sales for food trucks, invoice_revenue for
 * catering) of past events with actuals at the same event_name.
 *
 * 12-month rolling window so the baseline reflects the operator's
 * current draw rather than 3-year-old history that may not represent
 * the venue today.
 *
 * Returns a map keyed by event_name (lowercased + trimmed) → median.
 * Empty map when no eligible events.
 */
export function computeVenueMediansForTierInference(
  events: Pick<Event, "event_name" | "event_date" | "net_sales" | "invoice_revenue" | "event_mode" | "anomaly_flag">[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Map<string, number> {
  const cutoff = new Date(asOfDate + "T00:00:00");
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const byName = new Map<string, number[]>();
  for (const e of events) {
    if (e.event_date < cutoffStr || e.event_date > asOfDate) continue;
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

  const medians = new Map<string, number>();
  for (const [key, values] of byName) {
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    medians.set(key, median);
  }
  return medians;
}
