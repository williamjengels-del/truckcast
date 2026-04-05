import { median } from "./forecast-engine";
import type { Event, EventPerformance, ConfidenceLevel, TrendType } from "./database.types";

/**
 * Recalculate event performance stats for a given event name.
 * Follows the recalculation rules from the spec exactly.
 */
export function calculateEventPerformance(
  eventName: string,
  userId: string,
  events: Event[]
): Omit<EventPerformance, "id" | "updated_at"> {
  // Step 1: Filter to booked events with sales
  const relevantEvents = events.filter(
    (e) =>
      e.event_name.toLowerCase().trim() === eventName.toLowerCase().trim() &&
      e.booked &&
      e.net_sales !== null &&
      e.net_sales > 0
  );

  // Step 2: Exclude disrupted from stats (but count total booked)
  const statsEvents = relevantEvents.filter(
    (e) => e.anomaly_flag !== "disrupted"
  );

  const timesBooked = relevantEvents.length;

  if (statsEvents.length === 0) {
    return {
      user_id: userId,
      event_name: eventName,
      times_booked: timesBooked,
      total_sales: 0,
      avg_sales: 0,
      median_sales: 0,
      min_sales: 0,
      max_sales: 0,
      consistency_score: 0,
      yoy_growth: null,
      confidence: "LOW",
      confidence_band_low: null,
      confidence_band_high: null,
      trend: "New/Insufficient Data",
      years_active: null,
      forecast_next: null,
      notes: null,
    };
  }

  // Step 3: Calculate stats
  const sales = statsEvents.map((e) => e.net_sales!);
  const totalSales = sales.reduce((a, b) => a + b, 0);
  const avgSales = totalSales / sales.length;
  const medianSales = median(sales);
  const minSales = Math.min(...sales);
  const maxSales = Math.max(...sales);

  // Step 4: Consistency
  const variance =
    sales.length > 1
      ? sales.reduce((sum, s) => sum + Math.pow(s - avgSales, 2), 0) /
        sales.length
      : 0;
  const stddev = Math.sqrt(variance);
  const consistencyScore =
    avgSales > 0 ? Math.max(0, Math.round((1 - stddev / avgSales) * 100) / 100) : 0;

  // Step 5: YoY Growth
  const years = [
    ...new Set(statsEvents.map((e) => new Date(e.event_date + "T00:00:00").getFullYear())),
  ].sort();
  let yoyGrowth: number | null = null;

  if (years.length >= 2) {
    const latestYear = years[years.length - 1];
    const prevYear = years[years.length - 2];
    const latestEvents = statsEvents.filter(
      (e) => new Date(e.event_date + "T00:00:00").getFullYear() === latestYear
    );
    const prevEvents = statsEvents.filter(
      (e) => new Date(e.event_date + "T00:00:00").getFullYear() === prevYear
    );
    const latestAvg =
      latestEvents.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) /
      latestEvents.length;
    const prevAvg =
      prevEvents.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) /
      prevEvents.length;
    if (prevAvg > 0) {
      yoyGrowth =
        Math.round(((latestAvg - prevAvg) / prevAvg) * 100) / 100;
    }
  }

  // Step 6: Confidence
  // Based primarily on non-disrupted events. High disruption rate applies a small penalty.
  // Thresholds: HIGH >= 0.6, MEDIUM >= 0.35, LOW < 0.35 (matches forecast-engine thresholds).
  const disruptionRate = timesBooked > 0 ? (timesBooked - statsEvents.length) / timesBooked : 0;
  const disruptionPenalty = disruptionRate > 0.5 ? 1 : disruptionRate > 0.25 ? 0 : 0;
  let confidence: ConfidenceLevel = "LOW";
  if (statsEvents.length >= 10 && consistencyScore >= 0.6) {
    confidence = disruptionPenalty ? "MEDIUM" : "HIGH";
  } else if (statsEvents.length >= 5 && consistencyScore >= 0.7) {
    confidence = disruptionPenalty ? "MEDIUM" : "HIGH";
  } else if (statsEvents.length >= 2 && consistencyScore >= 0.5) {
    confidence = "MEDIUM";
  }

  // Step 7: Trend
  // Requires at least 2 non-disrupted data points AND at least 2 distinct years
  // to avoid a misleading trend call from a single event per year.
  let trend: TrendType = "New/Insufficient Data";
  if (years.length >= 2 && statsEvents.length >= 2) {
    if (yoyGrowth !== null && yoyGrowth > 0.1) {
      trend = "Growing";
    } else if (yoyGrowth !== null && yoyGrowth < -0.1) {
      trend = "Declining";
    } else {
      trend = "Stable";
    }
  }

  // Step 8: Confidence bands
  const confidenceBandLow =
    stddev > 0 ? Math.round((avgSales - stddev) * 100) / 100 : null;
  const confidenceBandHigh =
    stddev > 0 ? Math.round((avgSales + stddev) * 100) / 100 : null;

  // Years active string
  const yearsActive =
    years.length > 0
      ? years.length === 1
        ? `${years[0]}`
        : `${years[0]}-${years[years.length - 1]}`
      : null;

  // Forecast: weighted average (recent 2x)
  const currentYear = new Date().getFullYear();
  let weightedSum = 0;
  let totalWeight = 0;
  for (const e of statsEvents) {
    const year = new Date(e.event_date + "T00:00:00").getFullYear();
    const weight = year >= currentYear - 1 ? 2 : 1;
    weightedSum += (e.net_sales ?? 0) * weight;
    totalWeight += weight;
  }
  const forecastNext =
    totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;

  return {
    user_id: userId,
    event_name: eventName,
    times_booked: timesBooked,
    total_sales: Math.round(totalSales * 100) / 100,
    avg_sales: Math.round(avgSales * 100) / 100,
    median_sales: Math.round(medianSales * 100) / 100,
    min_sales: Math.round(minSales * 100) / 100,
    max_sales: Math.round(maxSales * 100) / 100,
    consistency_score: consistencyScore,
    yoy_growth: yoyGrowth,
    confidence,
    confidence_band_low: confidenceBandLow,
    confidence_band_high: confidenceBandHigh,
    trend,
    years_active: yearsActive,
    forecast_next: forecastNext,
    notes: null,
  };
}
