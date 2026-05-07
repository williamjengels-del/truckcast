import type { Event } from "./database.types";
import type { ForecastResult } from "./forecast-engine";

// Data-density framing: we're describing how well-fed the model is by the
// user's history, not a probability. "learning" originally surfaced as a
// "Learning" pill; per 2026-04-29 operator feedback the pill is no longer
// rendered (UI now substitutes a comparison-anchor sentence — see
// lowConfidenceAnchorSentence below). The DataDensity union and helpers stay
// so the framing is reachable if/when we revisit the reframing later.
export type DataDensity = "calibrated" | "building" | "learning";

export function dataDensityFromConfidence(
  confidence: "HIGH" | "MEDIUM" | "LOW" | null | undefined
): DataDensity {
  if (confidence === "HIGH") return "calibrated";
  if (confidence === "MEDIUM") return "building";
  return "learning";
}

export interface DataDensityPill {
  label: string;
  className: string;
}

export function dataDensityPill(density: DataDensity): DataDensityPill {
  switch (density) {
    case "calibrated":
      return {
        label: "Calibrated",
        className:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
      };
    case "building":
      return {
        label: "Building",
        className:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
      };
    case "learning":
      return {
        label: "Learning",
        className:
          "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
      };
  }
}

// Matches recalculate.ts forecastRange() so the stored DB columns
// and live-computed ranges agree. Kept in one place on purpose. Thresholds
// mirror confidenceScoreToLabel in forecast-engine so the pill (Calibrated /
// Building / Learning) and the range width stay aligned.
//
// Recalibrated 2026-05-07 from ±15/±25/±40 to ±30/±50/±80 based on
// audit of 396 forecast/actual pairs (scripts/audit-forecast-accuracy.mjs).
// Original bands were systematically too tight — engine claimed
// confidence it didn't have. New bands honestly reflect observed
// variance at each tier. See recalculate.ts:forecastRange for the
// full rationale.
export function forecastRangePct(confidenceScore: number): number {
  if (confidenceScore >= 0.65) return 0.30;
  if (confidenceScore >= 0.4) return 0.50;
  return 0.80;
}

export function computeForecastRange(
  forecast: number,
  confidenceScore: number
): { low: number; high: number } {
  const pct = forecastRangePct(confidenceScore);
  return {
    low: Math.round(forecast * (1 - pct)),
    high: Math.round(forecast * (1 + pct)),
  };
}

export function formatDollars(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatForecastRange(low: number, high: number): string {
  return `Likely ${formatDollars(low)}–${formatDollars(high)}`;
}

// Context sentence — plain English description of what the forecast is
// grounded in. Keyed off the method level and data points. Falls back to
// something short when details are missing.
//
// Platform-blend variants (L1 + cross-user data and L0 cold-start) are
// handled here so the phrasing stays consistent across /forecasts and the
// events list. Copy deliberately terse to avoid wrap on card widths.
export function forecastContextSentence(
  forecast: ForecastResult,
  event: Event
): string {
  const n = forecast.dataPoints;
  const ops = forecast.platformOperatorCount ?? 0;
  const dow = new Date(event.event_date + "T00:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long" }
  );
  const type = event.event_type ? event.event_type.toLowerCase() : "event";

  // Level 0: cold-start from platform data only, no personal history.
  if (forecast.level === 0) {
    return `Based on ${ops} other ${possessive(ops)} data — you haven't booked it yet`;
  }

  // Level 1 with a platform blend actually applied.
  // platformOperatorCount is now the count of OTHER operators (engine
  // self-filters via getPlatformEventsExcludingUser per operator-notes
  // Q2, 2026-04-28). Use it directly — no subtract. Privacy floor (2+
  // others) is enforced upstream in getPlatformEventsExcludingUser, so
  // when this branch fires ops is at least 2.
  if (forecast.level === 1 && forecast.platformBlendApplied && ops >= 1) {
    return `Based on your ${n} prior booking${n === 1 ? "" : "s"} + ${ops} other ${possessive(ops)} data`;
  }

  switch (forecast.level) {
    case 1:
      return `Based on your ${n} prior booking${n === 1 ? "" : "s"} at this event`;
    case 2:
      return `Based on ${n} similar ${type} ${pluralize(dow)} in your history`;
    case 3:
      return `Based on ${n} past ${type} event${n === 1 ? "" : "s"} in your history`;
    case 4:
      return `Based on ${n} past event${n === 1 ? "" : "s"} in the same season`;
    default:
      return `Based on ${n} event${n === 1 ? "" : "s"} in your history`;
  }
}

function pluralize(dayName: string): string {
  // "Saturday" → "Saturdays"
  return dayName.endsWith("s") ? dayName : `${dayName}s`;
}

// Replacement copy for the dropped "Learning" pill (operator feedback,
// 2026-04-29). Surfaces a comparison anchor when there's any history to
// compare against, and a "no forecast yet" prompt for true cold-starts.
//
// The engine still computes a confidence score under the hood — this
// helper just gives the UI a softer landing for low-confidence cases
// than a generic badge.
export function lowConfidenceAnchorSentence(
  forecast: ForecastResult,
  event: Event
): string {
  // L0 cold-start: no personal history; the platform-blend isn't enough to
  // anchor with a personal-history sentence. Spell out the next step.
  if (forecast.level === 0 || forecast.dataPoints === 0) {
    return "No forecast yet — need 2-3 prior bookings of this event before we can predict";
  }
  const eventNoun = event.event_type
    ? pluralize(event.event_type)
    : "events";
  const avg = formatDollars(forecast.baseForecast || forecast.forecast);
  return `Similar ${eventNoun} averaged ${avg} in your history`;
}

// Possessive form for "operator" — apostrophe placement depends on count.
//   1 → "operator's"  (singular possessive)
//   N → "operators'"  (plural possessive)
function possessive(count: number): string {
  return count === 1 ? "operator's" : "operators'";
}

// Plain-English adjustments, ordered by impact magnitude (largest first).
// Returns an empty array when nothing is materially adjusting the forecast.
export function plainEnglishAdjustments(
  forecast: ForecastResult,
  event: Event
): string[] {
  const items: { text: string; magnitude: number }[] = [];

  if (
    forecast.dayOfWeekAdjustment !== null &&
    forecast.dayOfWeekAdjustment !== undefined &&
    Math.abs(forecast.dayOfWeekAdjustment) >= 1
  ) {
    const dow = new Date(event.event_date + "T00:00:00").toLocaleDateString(
      "en-US",
      { weekday: "long" }
    );
    const runs =
      forecast.dayOfWeekAdjustment > 0 ? "run higher" : "run lower";
    items.push({
      text: `Day of week: ${signed(forecast.dayOfWeekAdjustment)} (${pluralize(dow)} ${runs})`,
      magnitude: Math.abs(forecast.dayOfWeekAdjustment),
    });
  }

  if (
    forecast.weatherAdjustment !== null &&
    forecast.weatherAdjustment !== undefined &&
    Math.abs(forecast.weatherAdjustment) >= 1 &&
    event.event_weather
  ) {
    const direction =
      forecast.weatherAdjustment > 0 ? "boosts sales" : "reduces crowds";
    items.push({
      text: `Weather: ${signed(forecast.weatherAdjustment)} (${event.event_weather} ${direction})`,
      magnitude: Math.abs(forecast.weatherAdjustment),
    });
  }

  if (
    forecast.attendanceAdjustment !== null &&
    forecast.attendanceAdjustment !== undefined &&
    Math.abs(forecast.attendanceAdjustment) >= 1
  ) {
    const direction =
      forecast.attendanceAdjustment > 0
        ? "larger expected crowd"
        : "smaller expected crowd";
    items.push({
      text: `Attendance: ${signed(forecast.attendanceAdjustment)} (${direction})`,
      magnitude: Math.abs(forecast.attendanceAdjustment),
    });
  }

  items.sort((a, b) => b.magnitude - a.magnitude);
  const out = items.map((i) => i.text);

  if (forecast.venueFamiliarityApplied) {
    out.push("Venue familiarity: applied (you've worked this venue before)");
  }
  if (
    forecast.platformBlendApplied &&
    forecast.platformOperatorCount !== undefined &&
    forecast.platformMedianSales != null
  ) {
    // platformOperatorCount is the count of OTHER operators (engine
    // self-filters per operator-notes Q2, 2026-04-28). Read as
    // "X other operators · median Y" — viewer's own data is excluded
    // from the median.
    const others = forecast.platformOperatorCount;
    out.push(
      `Community data: ${others} other operator${others === 1 ? "" : "s"} · median ${formatDollars(forecast.platformMedianSales)}`
    );
  }

  return out;
}

function signed(n: number): string {
  const rounded = Math.round(n);
  if (rounded >= 0) return `+${formatDollars(rounded)}`;
  return `-${formatDollars(Math.abs(rounded))}`;
}

// Fixed-revenue (catering/contract) detection. Pre-Phase-3 heuristic:
// the headline number an operator should see for these is the
// contracted/known revenue, not the model's gross-sales prediction.
//
// Cases:
//   - event_mode === "catering"             — invoiced up-front
//   - invoice_revenue > 0                   — invoice already in hand
//   - fee_type === "pre_settled"            — contracted payout in fee_rate
//   - fee_type === "commission_with_minimum"
//     && sales_minimum > 0                  — guaranteed floor
//
// For commission_with_minimum the forecast still has signal (upside
// above the floor), but headlining a forecast range below the
// contracted minimum is misleading. The display surfaces the floor
// instead, and per-event detail still shows the underlying forecast.
//
// Phase 3 will add a first-class events.revenue_model column and this
// helper should start reading that instead of inferring.
export function isFixedRevenueEvent(event: Event): boolean {
  if (event.event_mode === "catering") return true;
  if ((event.invoice_revenue ?? 0) > 0) return true;
  if (event.fee_type === "pre_settled") return true;
  if (event.fee_type === "commission_with_minimum" && (event.sales_minimum ?? 0) > 0) {
    return true;
  }
  return false;
}

export function fixedRevenueAmount(event: Event): number {
  // Pre-settled stores the contracted payout. Operators can put it in
  // EITHER fee_rate OR sales_minimum — both fields are visible in the
  // form and "sales minimum" reads naturally as "the guaranteed amount."
  // Take the max of whichever is populated so we never under-report the
  // contract.
  if (event.fee_type === "pre_settled") {
    const rate = event.fee_rate ?? 0;
    const minimum = event.sales_minimum ?? 0;
    const contract = Math.max(rate, minimum);
    if (contract > 0) return contract;
    // Fall through if neither field is filled — the caller's downstream
    // fallback (invoice_revenue / net_sales / forecast) still applies.
  }
  // Commission-with-minimum: the floor is the minimum guaranteed payout.
  // Show that as the headline; detail panels surface the upside potential.
  if (event.fee_type === "commission_with_minimum" && (event.sales_minimum ?? 0) > 0) {
    return event.sales_minimum;
  }
  // Catering / explicit invoice — prefer the invoice number.
  if ((event.invoice_revenue ?? 0) > 0) return event.invoice_revenue;
  if ((event.net_sales ?? 0) > 0) return event.net_sales ?? 0;
  return event.forecast_sales ?? 0;
}

// Empty-state test — when both the engine result and stored forecast are
// absent, show the "log more events" copy instead of a card.
export function hasUsableForecast(
  forecast: ForecastResult | null,
  event: Pick<Event, "forecast_sales">
): boolean {
  if (forecast && forecast.forecast > 0) return true;
  if (event.forecast_sales && event.forecast_sales > 0) return true;
  return false;
}
