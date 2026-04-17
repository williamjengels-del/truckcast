import type { Event } from "./database.types";
import type { ForecastResult } from "./forecast-engine";

// Data-density framing: we're describing how well-fed the model is by the
// user's history, not a probability. "Learning" positions thin data as the
// system doing its job, not failing.
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

// Matches recalculate-service.ts forecastRange() so the stored DB columns
// and live-computed ranges agree. Kept in one place on purpose.
export function forecastRangePct(confidenceScore: number): number {
  if (confidenceScore >= 0.7) return 0.15;
  if (confidenceScore >= 0.4) return 0.25;
  return 0.4;
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
export function forecastContextSentence(
  forecast: ForecastResult,
  event: Event
): string {
  const n = forecast.dataPoints;
  const dow = new Date(event.event_date + "T00:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long" }
  );
  const type = event.event_type ? event.event_type.toLowerCase() : "event";

  switch (forecast.level) {
    case 1:
      return `Based on ${n} prior time${n === 1 ? "" : "s"} you've run this event`;
    case 2:
      return `Based on ${n} similar ${type} ${pluralize(dow)} in your history`;
    case 3:
      return `Based on ${n} past ${type} event${n === 1 ? "" : "s"} in your history`;
    case 4:
      return `Based on ${n} past event${n === 1 ? "" : "s"} in the same season`;
    case 0:
      return `Based on ${forecast.platformOperatorCount ?? n} operators running similar events`;
    default:
      return `Based on ${n} event${n === 1 ? "" : "s"} in your history`;
  }
}

function pluralize(dayName: string): string {
  // "Saturday" → "Saturdays"
  return dayName.endsWith("s") ? dayName : `${dayName}s`;
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
    forecast.platformOperatorCount !== undefined &&
    forecast.platformOperatorCount >= 2 &&
    forecast.platformMedianSales != null
  ) {
    out.push(
      `Community benchmark: ${forecast.platformOperatorCount} other operators, median ${formatDollars(forecast.platformMedianSales)}`
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
// use event_mode === "catering" OR a positive invoice_revenue as the
// signal. Phase 3 will add a first-class events.revenue_model column
// and this helper should start reading that instead.
export function isFixedRevenueEvent(event: Event): boolean {
  if (event.event_mode === "catering") return true;
  if ((event.invoice_revenue ?? 0) > 0) return true;
  return false;
}

export function fixedRevenueAmount(event: Event): number {
  // Prefer the contract/invoice number; fall back to net_sales then forecast.
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
