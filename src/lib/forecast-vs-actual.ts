// Forecast-vs-actual rollup helpers for the dashboard surface.
//
// The "aha moment" for the forecasting product is when an operator
// logs sales after their first event and sees how the forecast did.
// Pre-2026-05-07 that signal lived only on /dashboard/events as the
// per-row variance line — the dashboard itself showed nothing about
// forecast accuracy. This lib computes two rollups for the dashboard
// forecast card:
//
//   1. Most recent past event with both forecast + actual logged.
//      Surfaces as "Sunset Hills May 2 — $1,058 actual, within range"
//      so the operator sees the freshest signal at the top of the
//      dashboard.
//
//   2. This-month accuracy stat (X of Y in range). Mirrors the
//      homepage's "4 out of 5 forecasts in range" promise on the
//      operator's own data once they have a few events.
//
// Range determination:
//   - If forecast_low and forecast_high are set on the row, use them
//     (PR #197 introduced these columns + the cron writes them on
//     every recalc).
//   - Fallback to ±20% of forecast_sales when range bounds are null.
//     Mirrors FORECAST_IN_RANGE_PCT in cron/weekly-digest/route.ts so
//     the dashboard + the digest email tell the operator the same
//     story.

import type { Event } from "@/lib/database.types";

const FALLBACK_RANGE_PCT = 0.20;

export type RangeOutcome = "within_range" | "below_range" | "above_range";

export interface RecentForecastResult {
  eventId: string;
  eventName: string;
  eventDate: string;
  actual: number;
  forecast: number;
  forecastLow: number;
  forecastHigh: number;
  /** True when the row carried explicit forecast_low / forecast_high
   *  bounds. False when the bounds were derived from the ±20%
   *  fallback. Useful for telemetry; UI doesn't currently distinguish. */
  hasExplicitBounds: boolean;
  outcome: RangeOutcome;
}

export interface MonthlyAccuracySummary {
  /** Number of past events this calendar month with both a forecast
   *  and an actual logged. */
  total: number;
  /** Number of those events whose actual landed in the forecast
   *  range (within the explicit bounds, or within ±20% of the point
   *  estimate when explicit bounds are missing). */
  inRange: number;
}

/** Filters: past, booked, has positive net_sales, has positive
 *  forecast, not anomaly-disrupted (disrupted events are excluded
 *  from accuracy stats by convention since they signal an external
 *  factor that broke the forecast — see day-of-event-state). */
function isEligible(event: Event, todayIso: string): boolean {
  if (!event.booked) return false;
  if (event.event_date >= todayIso) return false;
  if (event.net_sales === null || event.net_sales <= 0) return false;
  if (event.forecast_sales === null || event.forecast_sales <= 0) return false;
  if (event.anomaly_flag === "disrupted") return false;
  return true;
}

function rangeBoundsFor(event: Event): {
  low: number;
  high: number;
  hasExplicitBounds: boolean;
} {
  const forecast = event.forecast_sales ?? 0;
  if (event.forecast_low !== null && event.forecast_high !== null) {
    return {
      low: event.forecast_low,
      high: event.forecast_high,
      hasExplicitBounds: true,
    };
  }
  return {
    low: forecast * (1 - FALLBACK_RANGE_PCT),
    high: forecast * (1 + FALLBACK_RANGE_PCT),
    hasExplicitBounds: false,
  };
}

function classify(actual: number, low: number, high: number): RangeOutcome {
  if (actual < low) return "below_range";
  if (actual > high) return "above_range";
  return "within_range";
}

/** Returns the most recent eligible past event with forecast +
 *  actual logged, or null if none exists. */
export function getMostRecentForecastResult(
  events: Event[],
  todayIso: string
): RecentForecastResult | null {
  const eligible = events.filter((e) => isEligible(e, todayIso));
  if (eligible.length === 0) return null;

  // Most recent by event_date (DATE column, lexicographic sort works).
  // Tie-break on created_at so re-imports of the same date pick the
  // latest write.
  const sorted = [...eligible].sort((a, b) => {
    if (a.event_date !== b.event_date) {
      return b.event_date.localeCompare(a.event_date);
    }
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
  const event = sorted[0];

  const { low, high, hasExplicitBounds } = rangeBoundsFor(event);
  return {
    eventId: event.id,
    eventName: event.event_name,
    eventDate: event.event_date,
    actual: event.net_sales!,
    forecast: event.forecast_sales!,
    forecastLow: low,
    forecastHigh: high,
    hasExplicitBounds,
    outcome: classify(event.net_sales!, low, high),
  };
}

/** Computes how many of this calendar month's eligible past events
 *  landed in their forecast range. Returns null when the operator
 *  has zero eligible events this month — caller should hide the
 *  rolling accuracy line in that case rather than render "0 of 0
 *  in range." */
export function getThisMonthAccuracy(
  events: Event[],
  todayIso: string
): MonthlyAccuracySummary | null {
  // Calendar-month boundary using the todayIso prefix. todayIso is
  // expected as YYYY-MM-DD; first 7 chars give us the month bucket.
  // Caller passes the operator's local-tz today so we get the right
  // month even on edge dates near midnight.
  const monthPrefix = todayIso.slice(0, 7);
  const eligibleThisMonth = events.filter(
    (e) => isEligible(e, todayIso) && e.event_date.startsWith(monthPrefix)
  );

  if (eligibleThisMonth.length === 0) return null;

  let inRange = 0;
  for (const event of eligibleThisMonth) {
    const { low, high } = rangeBoundsFor(event);
    if (classify(event.net_sales!, low, high) === "within_range") {
      inRange++;
    }
  }
  return { total: eligibleThisMonth.length, inRange };
}
