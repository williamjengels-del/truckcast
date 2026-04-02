import { WEATHER_COEFFICIENTS, DAY_OF_WEEK_COEFFICIENTS } from "./constants";
import type { Event } from "./database.types";

export interface ForecastResult {
  forecast: number;
  level: 1 | 2 | 3 | 4;
  levelName: string;
  signal: string;
  baseForecast: number;
  weatherAdjustment: number | null;
  weatherCoefficient: number | null;
  dayOfWeekAdjustment: number | null;
  dayOfWeekCoefficient: number | null;
  attendanceAdjustment: number | null;
  dataPoints: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Hierarchical forecast engine with 4 fallback levels.
 * See truckcast-technical-spec.json for full algorithm description.
 */
export function calculateForecast(
  targetEvent: Partial<Event>,
  historicalEvents: Event[]
): ForecastResult | null {
  // Filter to booked events with sales, exclude disrupted
  const validEvents = historicalEvents.filter(
    (e) =>
      e.booked &&
      e.net_sales !== null &&
      e.net_sales > 0 &&
      e.anomaly_flag !== "disrupted"
  );

  if (validEvents.length === 0) return null;

  let result: ForecastResult | null = null;

  // Level 1: Direct Event History
  result = tryLevel1(targetEvent, validEvents);
  if (result) return applyAdjustments(result, targetEvent, validEvents);

  // Level 2: Similar Event Combo (same type + city area)
  result = tryLevel2(targetEvent, validEvents);
  if (result) return applyAdjustments(result, targetEvent, validEvents);

  // Level 3: Event Type Average
  result = tryLevel3(targetEvent, validEvents);
  if (result) return applyAdjustments(result, targetEvent, validEvents);

  // Level 4: Seasonal Monthly Average
  result = tryLevel4(targetEvent, validEvents);
  if (result) return applyAdjustments(result, targetEvent, validEvents);

  return null;
}

function tryLevel1(
  target: Partial<Event>,
  events: Event[]
): ForecastResult | null {
  if (!target.event_name) return null;

  const nameNormalized = target.event_name.toLowerCase().trim();
  const matching = events.filter(
    (e) => e.event_name.toLowerCase().trim() === nameNormalized
  );

  if (matching.length < 1) return null;

  // Weight: most recent year gets 2x, older years 1x
  const currentYear = new Date().getFullYear();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const e of matching) {
    const eventYear = new Date(e.event_date + "T00:00:00").getFullYear();
    const weight = eventYear === currentYear || eventYear === currentYear - 1 ? 2 : 1;
    weightedSum += (e.net_sales ?? 0) * weight;
    totalWeight += weight;
  }

  const forecast = weightedSum / totalWeight;

  return {
    forecast,
    level: 1,
    levelName: "Direct Event History",
    signal: "strongest",
    baseForecast: forecast,
    weatherAdjustment: null,
    weatherCoefficient: null,
    dayOfWeekAdjustment: null,
    dayOfWeekCoefficient: null,
    attendanceAdjustment: null,
    dataPoints: matching.length,
    confidence: getConfidence(matching.length, calculateConsistency(matching)),
  };
}

function tryLevel2(
  target: Partial<Event>,
  events: Event[]
): ForecastResult | null {
  if (!target.event_type || !target.city_area) return null;

  const matching = events.filter(
    (e) => e.event_type === target.event_type && e.city_area === target.city_area
  );

  if (matching.length < 3) return null;

  const avg = matching.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) / matching.length;

  return {
    forecast: avg,
    level: 2,
    levelName: "Similar Event Combo",
    signal: "strong",
    baseForecast: avg,
    weatherAdjustment: null,
    weatherCoefficient: null,
    dayOfWeekAdjustment: null,
    dayOfWeekCoefficient: null,
    attendanceAdjustment: null,
    dataPoints: matching.length,
    confidence: getConfidence(matching.length, calculateConsistency(matching)),
  };
}

function tryLevel3(
  target: Partial<Event>,
  events: Event[]
): ForecastResult | null {
  if (!target.event_type) return null;

  const matching = events.filter((e) => e.event_type === target.event_type);

  if (matching.length < 5) return null;

  const avg = matching.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) / matching.length;

  return {
    forecast: avg,
    level: 3,
    levelName: "Event Type Average",
    signal: "moderate",
    baseForecast: avg,
    weatherAdjustment: null,
    weatherCoefficient: null,
    dayOfWeekAdjustment: null,
    dayOfWeekCoefficient: null,
    attendanceAdjustment: null,
    dataPoints: matching.length,
    confidence: getConfidence(matching.length, calculateConsistency(matching)),
  };
}

function tryLevel4(
  target: Partial<Event>,
  events: Event[]
): ForecastResult | null {
  if (!target.event_date) return null;

  const targetMonth = new Date(target.event_date + "T00:00:00").getMonth();
  const matching = events.filter(
    (e) => new Date(e.event_date + "T00:00:00").getMonth() === targetMonth
  );

  if (matching.length < 10) {
    // Fallback to all events if not enough in the same month
    if (events.length >= 5) {
      const avg =
        events.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) / events.length;
      return {
        forecast: avg,
        level: 4,
        levelName: "Seasonal Monthly Average",
        signal: "weak — last resort",
        baseForecast: avg,
        weatherAdjustment: null,
        weatherCoefficient: null,
        dayOfWeekAdjustment: null,
        dayOfWeekCoefficient: null,
        attendanceAdjustment: null,
        dataPoints: events.length,
        confidence: "LOW",
      };
    }
    return null;
  }

  const avg = matching.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) / matching.length;

  return {
    forecast: avg,
    level: 4,
    levelName: "Seasonal Monthly Average",
    signal: "weak — last resort",
    baseForecast: avg,
    weatherAdjustment: null,
    weatherCoefficient: null,
    dayOfWeekAdjustment: null,
    dayOfWeekCoefficient: null,
    attendanceAdjustment: null,
    dataPoints: matching.length,
    confidence: "LOW",
  };
}

function applyAdjustments(
  result: ForecastResult,
  target: Partial<Event>,
  allEvents: Event[]
): ForecastResult {
  let adjusted = result.forecast;

  // Weather adjustment (only if weather is known and NOT using direct event history at level 1 for indoor events)
  if (target.event_weather) {
    const coeff = WEATHER_COEFFICIENTS[target.event_weather];
    if (coeff !== undefined && coeff !== 1.0) {
      result.weatherCoefficient = coeff;
      result.weatherAdjustment = adjusted * coeff - adjusted;
      adjusted *= coeff;
    }
  }

  // Day of week adjustment (only for levels 2-4, not level 1 which already encodes day-of-week)
  if (target.event_date && result.level > 1) {
    const dayName = new Date(target.event_date + "T00:00:00").toLocaleDateString(
      "en-US",
      { weekday: "long" }
    );
    const dayCoeff = DAY_OF_WEEK_COEFFICIENTS[dayName];
    if (dayCoeff !== undefined && dayCoeff !== 1.0) {
      result.dayOfWeekCoefficient = dayCoeff;
      result.dayOfWeekAdjustment = adjusted * dayCoeff - adjusted;
      adjusted *= dayCoeff;
    }
  }

  // Attendance adjustment (only for levels 2-4 when expected attendance is provided)
  if (target.expected_attendance && target.event_type && result.level > 1) {
    const sameType = allEvents.filter(
      (e) => e.event_type === target.event_type && e.expected_attendance
    );
    if (sameType.length > 0) {
      const avgAttendance =
        sameType.reduce((sum, e) => sum + (e.expected_attendance ?? 0), 0) /
        sameType.length;
      if (avgAttendance > 0) {
        const ratio = Math.min(
          2,
          target.expected_attendance / avgAttendance
        ); // Cap at 2x
        result.attendanceAdjustment = adjusted * ratio - adjusted;
        adjusted *= ratio;
      }
    }
  }

  result.forecast = Math.round(adjusted * 100) / 100;
  return result;
}

function calculateConsistency(events: Event[]): number {
  if (events.length < 2) return 0;
  const sales = events.map((e) => e.net_sales ?? 0);
  const mean = sales.reduce((a, b) => a + b, 0) / sales.length;
  if (mean === 0) return 0;
  const variance =
    sales.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sales.length;
  const stddev = Math.sqrt(variance);
  return Math.max(0, 1 - stddev / mean);
}

function getConfidence(
  count: number,
  consistency: number
): "HIGH" | "MEDIUM" | "LOW" {
  if (count >= 5 && consistency >= 0.7) return "HIGH";
  if (count >= 2 && consistency >= 0.5) return "MEDIUM";
  return "LOW";
}

/**
 * Calculate median of an array of numbers
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
