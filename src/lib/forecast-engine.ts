import { WEATHER_COEFFICIENTS, DAY_OF_WEEK_COEFFICIENTS } from "./constants";
import type { Event, WeatherType, EventType } from "./database.types";

// --- Calibrated Coefficients ---

export interface CalibratedCoefficients {
  dayOfWeek: Record<string, number>;
  eventType: Record<string, number>;
  weather: Record<string, number>;
  seasonal: Record<number, number>; // month (0-11) -> coefficient
  overallAvg: number;
  eventCount: number;
}

export interface VenueHistory {
  venueAvg: number;
  venueCount: number;
  venueConsistency: number;
}

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
  /** Numeric confidence score from 0 to 1 */
  confidenceScore: number;
  /** Whether per-user calibrated coefficients were used */
  calibrated: boolean;
  /** Venue familiarity bonus applied */
  venueFamiliarityApplied: boolean;
}

export interface ForecastOptions {
  /** Pre-computed calibrated coefficients for this user. If not provided, defaults are used. */
  calibratedCoefficients?: CalibratedCoefficients | null;
}

// --- Recency weighting helpers ---

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

function recencyWeight(eventDate: string): number {
  const eventTime = new Date(eventDate + "T00:00:00").getTime();
  const now = Date.now();
  return now - eventTime <= SIX_MONTHS_MS ? 2 : 1;
}

function weightedAverage(events: Event[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const e of events) {
    const w = recencyWeight(e.event_date);
    weightedSum += (e.net_sales ?? 0) * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// --- Coefficient calibration ---

/**
 * Calibrate per-user coefficients from their historical event data.
 * Requires at least 10 valid events to produce meaningful coefficients.
 * Returns null if insufficient data.
 */
export function calibrateCoefficients(
  historicalEvents: Event[]
): CalibratedCoefficients | null {
  const validEvents = historicalEvents.filter(
    (e) =>
      e.booked &&
      e.net_sales !== null &&
      e.net_sales > 0 &&
      e.anomaly_flag !== "disrupted"
  );

  if (validEvents.length < 10) return null;

  // Overall weighted average
  const overallAvg = weightedAverage(validEvents);
  if (overallAvg === 0) return null;

  // Day-of-week coefficients
  const dayOfWeek: Record<string, number> = {};
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  for (const dayName of dayNames) {
    const dayEvents = validEvents.filter(
      (e) =>
        new Date(e.event_date + "T00:00:00").toLocaleDateString("en-US", {
          weekday: "long",
        }) === dayName
    );
    if (dayEvents.length >= 3) {
      dayOfWeek[dayName] = weightedAverage(dayEvents) / overallAvg;
    }
  }

  // Event type coefficients
  const eventTypeCoeffs: Record<string, number> = {};
  const eventTypes = [...new Set(validEvents.map((e) => e.event_type).filter(Boolean))] as string[];
  for (const et of eventTypes) {
    const typeEvents = validEvents.filter((e) => e.event_type === et);
    if (typeEvents.length >= 3) {
      eventTypeCoeffs[et] = weightedAverage(typeEvents) / overallAvg;
    }
  }

  // Weather coefficients
  const weatherCoeffs: Record<string, number> = {};
  const weatherTypes = [...new Set(validEvents.map((e) => e.event_weather).filter(Boolean))] as string[];
  for (const wt of weatherTypes) {
    const weatherEvents = validEvents.filter((e) => e.event_weather === wt);
    if (weatherEvents.length >= 2) {
      weatherCoeffs[wt] = weightedAverage(weatherEvents) / overallAvg;
    }
  }

  // Seasonal (monthly) coefficients
  const seasonal: Record<number, number> = {};
  for (let month = 0; month < 12; month++) {
    const monthEvents = validEvents.filter(
      (e) => new Date(e.event_date + "T00:00:00").getMonth() === month
    );
    if (monthEvents.length >= 3) {
      seasonal[month] = weightedAverage(monthEvents) / overallAvg;
    }
  }

  return {
    dayOfWeek,
    eventType: eventTypeCoeffs,
    weather: weatherCoeffs,
    seasonal,
    overallAvg,
    eventCount: validEvents.length,
  };
}

// --- Venue familiarity ---

/**
 * Get venue history for a given location from historical events.
 * Matches on normalized location string.
 */
export function getVenueHistory(
  location: string,
  historicalEvents: Event[]
): VenueHistory | null {
  if (!location) return null;

  const normalized = location.toLowerCase().trim();
  const venueEvents = historicalEvents.filter(
    (e) =>
      e.location &&
      e.location.toLowerCase().trim() === normalized &&
      e.booked &&
      e.net_sales !== null &&
      e.net_sales > 0 &&
      e.anomaly_flag !== "disrupted"
  );

  if (venueEvents.length < 2) return null;

  return {
    venueAvg: weightedAverage(venueEvents),
    venueCount: venueEvents.length,
    venueConsistency: calculateConsistency(venueEvents),
  };
}

// --- Confidence scoring ---

/**
 * Calculate a numeric confidence score from 0 to 1 based on:
 * - Number of similar historical events (data depth)
 * - Data recency (how recent the data points are)
 * - Whether calibrated or default coefficients are used
 * - Consistency of the data
 */
function calculateConfidenceScore(
  dataPoints: number,
  events: Event[],
  calibrated: boolean,
  consistency: number,
  venueFamiliar: boolean
): number {
  // Data depth score: 0-0.3 (logarithmic, caps around 20 events)
  const depthScore = Math.min(0.3, 0.3 * (Math.log2(dataPoints + 1) / Math.log2(21)));

  // Recency score: 0-0.25 (proportion of events in last 6 months)
  const recentCount = events.filter((e) => {
    const age = Date.now() - new Date(e.event_date + "T00:00:00").getTime();
    return age <= SIX_MONTHS_MS;
  }).length;
  const recencyScore = events.length > 0 ? 0.25 * (recentCount / events.length) : 0;

  // Calibration bonus: 0 or 0.15
  const calibrationScore = calibrated ? 0.15 : 0;

  // Consistency score: 0-0.2
  const consistencyScore = 0.2 * Math.max(0, consistency);

  // Venue familiarity bonus: 0 or 0.1
  const venueScore = venueFamiliar ? 0.1 : 0;

  return Math.min(1, depthScore + recencyScore + calibrationScore + consistencyScore + venueScore);
}

function confidenceScoreToLabel(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 0.6) return "HIGH";
  if (score >= 0.35) return "MEDIUM";
  return "LOW";
}

// --- Main forecast engine ---

/**
 * Hierarchical forecast engine with 4 fallback levels.
 * See truckcast-technical-spec.json for full algorithm description.
 *
 * @param targetEvent - The event to forecast
 * @param historicalEvents - All historical events for this user
 * @param options - Optional: calibrated coefficients, etc.
 */
export function calculateForecast(
  targetEvent: Partial<Event>,
  historicalEvents: Event[],
  options?: ForecastOptions
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

  const calibrated = options?.calibratedCoefficients ?? null;

  // Check venue familiarity
  const venueHistory = targetEvent.location
    ? getVenueHistory(targetEvent.location, historicalEvents)
    : null;

  let result: ForecastResult | null = null;

  // Level 1: Direct Event History
  result = tryLevel1(targetEvent, validEvents);
  if (result) return applyAdjustments(result, targetEvent, validEvents, calibrated, venueHistory);

  // Level 2: Similar Event Combo (same type + city area)
  result = tryLevel2(targetEvent, validEvents);
  if (result) return applyAdjustments(result, targetEvent, validEvents, calibrated, venueHistory);

  // Level 3: Event Type Average
  result = tryLevel3(targetEvent, validEvents, calibrated);
  if (result) return applyAdjustments(result, targetEvent, validEvents, calibrated, venueHistory);

  // Level 4: Seasonal Monthly Average
  result = tryLevel4(targetEvent, validEvents, calibrated);
  if (result) return applyAdjustments(result, targetEvent, validEvents, calibrated, venueHistory);

  return null;
}

function makeResult(
  partial: Omit<ForecastResult, "confidenceScore" | "calibrated" | "venueFamiliarityApplied">
): ForecastResult {
  return {
    ...partial,
    confidenceScore: 0,
    calibrated: false,
    venueFamiliarityApplied: false,
  };
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

  // Recency-weighted average
  const forecast = weightedAverage(matching);

  return makeResult({
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
  });
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

  const avg = weightedAverage(matching);

  return makeResult({
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
  });
}

function tryLevel3(
  target: Partial<Event>,
  events: Event[],
  calibrated: CalibratedCoefficients | null
): ForecastResult | null {
  if (!target.event_type) return null;

  const matching = events.filter((e) => e.event_type === target.event_type);

  if (matching.length < 5) return null;

  let avg: number;

  // If calibrated coefficients include this event type, use overall avg * type coefficient
  if (calibrated && calibrated.eventType[target.event_type]) {
    avg = calibrated.overallAvg * calibrated.eventType[target.event_type];
  } else {
    avg = weightedAverage(matching);
  }

  return makeResult({
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
  });
}

function tryLevel4(
  target: Partial<Event>,
  events: Event[],
  calibrated: CalibratedCoefficients | null
): ForecastResult | null {
  if (!target.event_date) return null;

  const targetMonth = new Date(target.event_date + "T00:00:00").getMonth();
  const matching = events.filter(
    (e) => new Date(e.event_date + "T00:00:00").getMonth() === targetMonth
  );

  // Try calibrated seasonal coefficient first
  if (calibrated && calibrated.seasonal[targetMonth] !== undefined) {
    const avg = calibrated.overallAvg * calibrated.seasonal[targetMonth];
    return makeResult({
      forecast: avg,
      level: 4,
      levelName: "Seasonal Monthly Average",
      signal: "weak -- last resort",
      baseForecast: avg,
      weatherAdjustment: null,
      weatherCoefficient: null,
      dayOfWeekAdjustment: null,
      dayOfWeekCoefficient: null,
      attendanceAdjustment: null,
      dataPoints: matching.length > 0 ? matching.length : events.length,
      confidence: "LOW",
    });
  }

  if (matching.length < 10) {
    // Fallback to all events if not enough in the same month
    if (events.length >= 5) {
      const avg = weightedAverage(events);
      return makeResult({
        forecast: avg,
        level: 4,
        levelName: "Seasonal Monthly Average",
        signal: "weak -- last resort",
        baseForecast: avg,
        weatherAdjustment: null,
        weatherCoefficient: null,
        dayOfWeekAdjustment: null,
        dayOfWeekCoefficient: null,
        attendanceAdjustment: null,
        dataPoints: events.length,
        confidence: "LOW",
      });
    }
    return null;
  }

  const avg = weightedAverage(matching);

  return makeResult({
    forecast: avg,
    level: 4,
    levelName: "Seasonal Monthly Average",
    signal: "weak -- last resort",
    baseForecast: avg,
    weatherAdjustment: null,
    weatherCoefficient: null,
    dayOfWeekAdjustment: null,
    dayOfWeekCoefficient: null,
    attendanceAdjustment: null,
    dataPoints: matching.length,
    confidence: "LOW",
  });
}

function applyAdjustments(
  result: ForecastResult,
  target: Partial<Event>,
  allEvents: Event[],
  calibrated: CalibratedCoefficients | null,
  venueHistory: VenueHistory | null
): ForecastResult {
  let adjusted = result.forecast;
  const isCalibrated = calibrated !== null && calibrated.eventCount >= 10;
  result.calibrated = isCalibrated;

  // Venue familiarity: blend venue average with current forecast
  // If venue has good history (3+ events, decent consistency), use it as strong signal
  if (venueHistory && venueHistory.venueCount >= 3 && result.level > 1) {
    // Blend: venue weight depends on venue consistency and count
    const venueWeight = Math.min(0.5, 0.15 * Math.min(venueHistory.venueCount, 5) * venueHistory.venueConsistency);
    adjusted = adjusted * (1 - venueWeight) + venueHistory.venueAvg * venueWeight;
    result.venueFamiliarityApplied = true;
  } else if (venueHistory && venueHistory.venueCount >= 2 && result.level > 1) {
    // Lighter blend for 2 venue events
    const venueWeight = 0.15 * venueHistory.venueConsistency;
    adjusted = adjusted * (1 - venueWeight) + venueHistory.venueAvg * venueWeight;
    result.venueFamiliarityApplied = true;
  }

  // Weather adjustment
  if (target.event_weather) {
    let coeff: number | undefined;
    // Prefer calibrated weather coefficients
    if (isCalibrated && calibrated!.weather[target.event_weather] !== undefined) {
      coeff = calibrated!.weather[target.event_weather];
    } else {
      coeff = WEATHER_COEFFICIENTS[target.event_weather];
    }
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
    let dayCoeff: number | undefined;
    // Prefer calibrated day-of-week coefficients
    if (isCalibrated && calibrated!.dayOfWeek[dayName] !== undefined) {
      dayCoeff = calibrated!.dayOfWeek[dayName];
    } else {
      dayCoeff = DAY_OF_WEEK_COEFFICIENTS[dayName];
    }
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

  // Calculate numeric confidence score
  const matchingEvents = getMatchingEventsForLevel(result.level, target, allEvents);
  result.confidenceScore = calculateConfidenceScore(
    result.dataPoints,
    matchingEvents,
    isCalibrated,
    calculateConsistency(matchingEvents),
    result.venueFamiliarityApplied
  );

  // Override label with score-based label for consistency
  result.confidence = confidenceScoreToLabel(result.confidenceScore);

  return result;
}

/**
 * Get the matching events that were used for a given forecast level.
 * Used for confidence score calculation.
 */
function getMatchingEventsForLevel(
  level: number,
  target: Partial<Event>,
  events: Event[]
): Event[] {
  switch (level) {
    case 1: {
      if (!target.event_name) return events;
      const nameNormalized = target.event_name.toLowerCase().trim();
      return events.filter(
        (e) => e.event_name.toLowerCase().trim() === nameNormalized
      );
    }
    case 2:
      return events.filter(
        (e) => e.event_type === target.event_type && e.city_area === target.city_area
      );
    case 3:
      return events.filter((e) => e.event_type === target.event_type);
    case 4: {
      if (!target.event_date) return events;
      const targetMonth = new Date(target.event_date + "T00:00:00").getMonth();
      const monthly = events.filter(
        (e) => new Date(e.event_date + "T00:00:00").getMonth() === targetMonth
      );
      return monthly.length >= 10 ? monthly : events;
    }
    default:
      return events;
  }
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
