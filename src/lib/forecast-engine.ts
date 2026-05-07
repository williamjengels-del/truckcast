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
  level: number;
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
  /** Platform cross-user data available for this event */
  platformOperatorCount?: number;
  platformMedianSales?: number;
  /** Cross-user platform data actually changed the forecast number
   *  (either blended into Level 1 personal history or served as the
   *  base for Level 0 cold-start). UI uses this to decide when to
   *  surface the "based on X other operators" language. */
  platformBlendApplied: boolean;
  /** True when the engine produced a forecast value far below the
   *  operator's typical event revenue — signal that the per-event
   *  history is too thin for the model to land on a believable
   *  number. UI consumers should branch on this and surface
   *  "insufficient data" copy instead of the bogus tail forecast.
   *  Recalc clears the stored forecast columns when this fires so
   *  past-event variance lines and dashboard hit-rate stats don't
   *  count the row. See INSUFFICIENT_DATA_FLOOR_RATIO. */
  insufficientData: boolean;
}

export interface ForecastOptions {
  /** Pre-computed calibrated coefficients for this user. If not provided, defaults are used. */
  calibratedCoefficients?: CalibratedCoefficients | null;
  /** Cross-user platform aggregate for this event, if available */
  platformEvent?: {
    median_sales: number | null;
    operator_count: number;
    total_instances: number;
    sales_p25?: number | null;
    sales_p75?: number | null;
  } | null;
}

// --- Multi-day series detection ---

/**
 * Determines which day-of-series a given event date falls on for a named event.
 *
 * A "series" is a cluster of dates for the same event name where consecutive
 * dates are ≤ MAX_GAP_DAYS apart. Weekly recurring events (7-day gap) are
 * naturally excluded. Multi-day festivals like Shutterfest (1–3 day gaps) are
 * detected and get a 1-indexed position.
 *
 * Returns null if the date is not part of a multi-day cluster (i.e., it stands
 * alone or is a weekly/monthly recurring event).
 */
const SERIES_MAX_GAP_DAYS = 5;

export function getSeriesDay(
  targetDate: string,
  allDatesForName: string[] // unique dates for this event name, sorted ascending
): number | null {
  if (allDatesForName.length < 2) return null;

  // Build consecutive-day clusters
  const clusters: string[][] = [];
  let current: string[] = [allDatesForName[0]];

  for (let i = 1; i < allDatesForName.length; i++) {
    const prevMs = new Date(allDatesForName[i - 1] + "T00:00:00").getTime();
    const currMs = new Date(allDatesForName[i] + "T00:00:00").getTime();
    const gapDays = (currMs - prevMs) / (1000 * 60 * 60 * 24);
    if (gapDays <= SERIES_MAX_GAP_DAYS) {
      current.push(allDatesForName[i]);
    } else {
      clusters.push(current);
      current = [allDatesForName[i]];
    }
  }
  clusters.push(current);

  // Find which cluster contains targetDate
  const cluster = clusters.find((c) => c.includes(targetDate));
  if (!cluster || cluster.length < 2) return null;

  return cluster.indexOf(targetDate) + 1; // 1-indexed
}

// --- Recency weighting helpers ---

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

/** Total recognised revenue for an event: on-site sales + catering invoice */
function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
}

/** True if an event has any recognised revenue */
function hasRevenue(e: Event): boolean {
  return (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && e.invoice_revenue > 0);
}

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
    weightedSum += eventRevenue(e) * w;
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
      !e.cancellation_reason &&
      hasRevenue(e) &&
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

// Words that, when appearing as the suffix after a dash, describe a sub-area
// of a larger venue (a parking lot, stage, meadow, etc.) rather than a distinct
// venue. Stripping them lets "Tower Grove Park" match "Tower Grove Park - South
// Meadow". Kept deliberately narrow — if every word in the trailing segment is
// in this set, strip; otherwise leave the suffix alone.
const VENUE_SUBAREA_WORDS = new Set([
  // directional / positional
  "north", "south", "east", "west", "main", "upper", "lower", "front",
  "back", "inner", "outer", "side",
  // sub-area types
  "stage", "lot", "pavilion", "meadow", "field", "entrance", "gate", "lobby",
  "wing", "hall", "parking", "area", "section", "room", "tent", "court",
  "plaza", "deck", "patio", "block", "floor", "level", "door", "balcony",
  "mezzanine", "garden", "patio", "terrace", "arena",
]);

/**
 * Normalize a location string for venue-familiarity matching.
 *
 *  - lowercase, trim
 *  - strip parentheticals:    "Kiener Plaza (North Lot)" → "kiener plaza"
 *  - strip dash-suffixes whose every word is a known venue sub-area:
 *      "Tower Grove Park - South Meadow" → "tower grove park"
 *      "Ballpark Village - Upper Deck"   → "ballpark village"
 *    (a suffix like "- Jazz Concert" is preserved — "jazz" and "concert"
 *    aren't sub-area words)
 *  - collapse multiple whitespace runs
 *
 * Applied at comparison time only; the stored location string is never
 * modified.
 */
export function normalizeLocation(raw: string): string {
  if (!raw) return "";
  let s = raw.toLowerCase();
  // strip parenthetical qualifiers
  s = s.replace(/\s*\([^)]*\)\s*/g, " ");
  // strip trailing dash-suffix if every word is a sub-area term.
  // accepts " - ", " – ", " — " or just "-" with optional whitespace.
  const parts = s.split(/\s*[–—-]\s*/);
  if (parts.length >= 2) {
    const suffix = parts[parts.length - 1].trim();
    if (suffix) {
      const words = suffix.split(/\s+/).filter(Boolean);
      if (words.length > 0 && words.every((w) => VENUE_SUBAREA_WORDS.has(w))) {
        s = parts.slice(0, -1).join(" - ");
      }
    }
  }
  // collapse whitespace
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Get venue history for a given location from historical events.
 * Matches on normalized location string (strips sub-area suffixes like
 * "- South Meadow" so repeat bookings at the same venue match across
 * different cosmetic location strings).
 */
export function getVenueHistory(
  location: string,
  historicalEvents: Event[]
): VenueHistory | null {
  if (!location) return null;

  const normalized = normalizeLocation(location);
  if (!normalized) return null;

  const venueEvents = historicalEvents.filter(
    (e) =>
      e.location &&
      normalizeLocation(e.location) === normalized &&
      e.booked &&
      !e.cancellation_reason &&
      hasRevenue(e) &&
      e.anomaly_flag !== "disrupted"
  );

  if (venueEvents.length < 2) return null;

  return {
    venueAvg: weightedAverage(venueEvents),
    venueCount: venueEvents.length,
    venueConsistency: calculateConsistency(venueEvents),
  };
}

/**
 * Auto-derive an event tier from the user's name-match history, together
 * with the inputs that decided it. Useful for UIs that want to explain
 * why a given tier was assigned.
 *
 *  - "A": ≥ 3 valid prior instances AND consistency ≥ 0.70   (+0.10 score)
 *  - "B": ≥ 2 prior instances AND consistency ≥ 0.50,
 *          OR ≥ 3 prior instances with consistency 0.50–0.69  (+0.05 score)
 *  - null: otherwise                                          (0)
 *
 * Valid = booked + has revenue + not cancelled + not anomaly=disrupted
 * (matches the filter used everywhere else in the engine).
 *
 * Note: because Level 1 fires whenever ≥ 1 name match exists, tiered events
 * always forecast via Level 1. Events routed to Level 3/4 by definition have
 * no name history and therefore no derived tier.
 */
export interface DerivedTierDetails {
  tier: "A" | "B" | null;
  instances: number;
  consistency: number;
}

export function getDerivedTierDetails(
  eventName: string,
  historicalEvents: Event[]
): DerivedTierDetails {
  if (!eventName) return { tier: null, instances: 0, consistency: 0 };
  const nameNorm = eventName.toLowerCase().trim();
  const matches = historicalEvents.filter(
    (e) =>
      e.event_name.toLowerCase().trim() === nameNorm &&
      e.booked &&
      !e.cancellation_reason &&
      hasRevenue(e) &&
      e.anomaly_flag !== "disrupted"
  );
  const consistency = calculateConsistency(matches);
  let tier: "A" | "B" | null = null;
  if (matches.length >= 3 && consistency >= 0.7) tier = "A";
  else if (matches.length >= 2 && consistency >= 0.5) tier = "B";
  return { tier, instances: matches.length, consistency };
}

export function deriveEventTier(
  eventName: string,
  historicalEvents: Event[]
): "A" | "B" | null {
  return getDerivedTierDetails(eventName, historicalEvents).tier;
}

// --- Confidence scoring ---

/**
 * Detect the typical frequency of a set of events (in days between occurrences).
 * Used to adjust the recency window — annual events shouldn't be penalised for
 * data that is 12 months old when 6 months was always their natural cadence.
 */
function detectEventFrequencyDays(events: Event[]): number {
  if (events.length < 2) return 365; // assume annual if only one data point
  const sorted = [...events].sort((a, b) =>
    new Date(a.event_date + "T00:00:00").getTime() -
    new Date(b.event_date + "T00:00:00").getTime()
  );
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ms =
      new Date(sorted[i].event_date + "T00:00:00").getTime() -
      new Date(sorted[i - 1].event_date + "T00:00:00").getTime();
    gaps.push(ms / (1000 * 60 * 60 * 24));
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return avgGap;
}

/**
 * Calculate a numeric confidence score from 0 to 1 based on 7 components:
 * - Data depth:        up to 0.30  (log-scaled, maxes at 10+ matches)
 * - Recency:           up to 0.20  (adaptive window; annual events not penalised)
 * - Calibration:       0 or 0.15   (per-user coefficients active at ≥ 10 valid events)
 * - Consistency:       up to 0.20  (1 − stddev/mean across matches)
 * - Venue familiarity: 0 or 0.10   (blended ≥ 2 events at same normalized venue, level > 1)
 * - Tier (auto):       0 / 0.05 / 0.10   (see deriveEventTier)
 * - Community:         0 / 0.05 / 0.10   (≥ 3 / ≥ 8 other operators in platform registry)
 *
 * Components are additive; total capped at 1.0.
 */
function calculateConfidenceScore(
  dataPoints: number,
  events: Event[],
  calibrated: boolean,
  consistency: number,
  venueFamiliar: boolean,
  eventTier: "A" | "B" | null,
  platformOperatorCount: number
): number {
  const depthScore = Math.min(0.3, 0.3 * (Math.log2(dataPoints + 1) / Math.log2(11)));

  const freqDays = detectEventFrequencyDays(events);
  const windowMs = Math.min(
    18 * 30 * 24 * 60 * 60 * 1000,
    Math.max(SIX_MONTHS_MS, freqDays * 1.3 * 24 * 60 * 60 * 1000)
  );
  const recentCount = events.filter((e) => {
    const age = Date.now() - new Date(e.event_date + "T00:00:00").getTime();
    return age <= windowMs;
  }).length;
  const recencyScore = events.length > 0 ? 0.2 * (recentCount / events.length) : 0;

  const calibrationScore = calibrated ? 0.15 : 0;
  const consistencyScore = 0.2 * Math.max(0, consistency);
  const venueScore = venueFamiliar ? 0.1 : 0;
  const tierScore = eventTier === "A" ? 0.1 : eventTier === "B" ? 0.05 : 0;

  // Community agreement bonus: ≥ 8 OTHER operators in the platform registry
  // for this event → 0.10; 3–7 → 0.05; < 3 → 0. Rewards the user for running
  // events where independent operators are producing similar numbers.
  //
  // Threshold semantics LOCKED 2026-05-02: counts OTHER operators only, not
  // total. Since the Q2 self-filter fix (2026-04-28) the engine reads
  // platformOperatorCount via getPlatformEventsExcludingUser() which strips
  // the requesting user. At small platform scale this means: ≥3 peers
  // (i.e. 4+ total operators booking this event, you + 3 others) before
  // the 0.05 boost kicks in. Privacy floor at the publication side
  // (platform-registry.ts) is 2+ peers — so the boost intentionally
  // requires more density than mere publication.
  const communityScore =
    platformOperatorCount >= 8 ? 0.1 :
    platformOperatorCount >= 3 ? 0.05 : 0;

  return Math.min(
    1,
    depthScore + recencyScore + calibrationScore + consistencyScore + venueScore + tierScore + communityScore
  );
}

// Single source of truth for the three score-to-label cutoffs. The
// forecast-range band widths in forecast-display.ts and
// recalculate-service.ts share these same thresholds.
export const CONFIDENCE_HIGH_THRESHOLD = 0.65;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.4;

function confidenceScoreToLabel(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= CONFIDENCE_HIGH_THRESHOLD) return "HIGH";
  if (score >= CONFIDENCE_MEDIUM_THRESHOLD) return "MEDIUM";
  return "LOW";
}

// --- Insufficient-data floor ---

/**
 * Floor ratio for the insufficient-data check. When the engine's
 * final forecast is below this fraction of the operator's overall
 * median event revenue, the result is flagged as insufficientData
 * and UI consumers should surface a "not enough history" treatment
 * instead of the bogus tail number.
 *
 * Why a floor at all: 2026-05-07 audit found the engine was producing
 * $2-$200 point estimates for events that did $300-$5,000 (e.g.
 * "School of Rock House Band at Wellspent" — $2 forecast, $286
 * actual). These came from Level-1 name matches with 1-2 prior
 * data points where the prior events had near-zero sales (off-night
 * at a brewery, etc.) and the engine averaged on the small sample.
 * The model has no business publishing those numbers as a forecast.
 *
 * 0.10 chosen because it cleanly separates the audit's tail-event
 * misses (all under $200 against operator median ~$1,200) from
 * legitimately quiet venues (Wellspent Brewery weeknight averages
 * around $300, ~25% of overall median, stays above the floor).
 */
export const INSUFFICIENT_DATA_FLOOR_RATIO = 0.1;

/**
 * Median revenue across an operator's eligible historical events.
 * Used as the anchor for the insufficient-data floor check.
 */
export function computeOperatorOverallMedian(events: Event[]): number {
  const valid = events.filter(
    (e) =>
      e.booked &&
      !e.cancellation_reason &&
      hasRevenue(e) &&
      e.anomaly_flag !== "disrupted"
  );
  if (valid.length === 0) return 0;
  return median(valid.map(eventRevenue));
}

/**
 * Mark a forecast result as insufficientData when the final number
 * sits below the floor. Operates in place and returns the same
 * reference for chaining. No-op when validEvents is empty (engine
 * already returned null in that case) or median is zero.
 */
function markInsufficientDataIfBelowFloor(
  result: ForecastResult,
  validEvents: Event[]
): ForecastResult {
  const operatorMedian = median(validEvents.map(eventRevenue));
  if (operatorMedian <= 0 || result.forecast <= 0) return result;
  if (result.forecast < INSUFFICIENT_DATA_FLOOR_RATIO * operatorMedian) {
    result.insufficientData = true;
  }
  return result;
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
/** Public input type for calculateForecast — relaxes event_type to any string
 *  so callers don't need to use the strict EventType enum. The engine handles
 *  unknown event types via Level 3/4 fallbacks. */
export type ForecastTarget = Omit<Partial<Event>, "event_type" | "event_date"> & {
  event_name: string;
  event_type?: string | null;
  event_date?: string | null;
};

export function calculateForecast(
  targetEvent: ForecastTarget,
  historicalEvents: Event[],
  options?: ForecastOptions
): ForecastResult | null {
  // Internal cast: all fields match Partial<Event> except event_type which is widened
  const target = targetEvent as Partial<Event>;
  // Filter to booked events with revenue (net_sales or catering invoice), exclude disrupted
  const validEvents = historicalEvents.filter(
    (e) =>
      e.booked &&
      !e.cancellation_reason &&
      hasRevenue(e) &&
      e.anomaly_flag !== "disrupted"
  );

  if (validEvents.length === 0) return null;

  const calibrated = options?.calibratedCoefficients ?? null;

  // Check venue familiarity
  const venueHistory = target.location
    ? getVenueHistory(target.location, historicalEvents)
    : null;

  const platformEvent = options?.platformEvent ?? null;
  const platformMedian = (platformEvent?.median_sales ?? 0) > 0 ? (platformEvent!.median_sales as number) : 0;
  const platformOpCount = platformEvent?.operator_count ?? 0;

  let result: ForecastResult | null = null;

  // Level 1: Direct Event History
  result = tryLevel1(target, validEvents, historicalEvents);

  if (result && platformMedian > 0 && platformOpCount >= 3) {
    // Blend personal history with platform aggregate.
    //
    // Calibration retune 2026-05-06 after Sunset Hills Maker's Market
    // surfaced as a real over-forecast: operator had 1 personal data
    // point ($1,058 actual) and the engine produced $1,752 — the old
    // 55%-personal / 45%-platform blend at n=1 was pulling forecasts
    // too aggressively toward platform median when the operator's own
    // data was thin AND the platform sample was itself thin (n_op=2).
    //
    // Two changes here:
    //   1. Raise the gate: platform_operator_count must be >= 3 (was
    //      >= 2). Two-operator samples are too noisy to reliably
    //      adjust against; require a third signal before blending.
    //   2. Cap platform weight at 25% — personal_weight never drops
    //      below 0.75 regardless of how thin the operator's data is.
    //      Mature personal data (5+ points) still keeps the existing
    //      0.85 weight (15% platform) — those operators have proven
    //      consistency and shouldn't be pulled around by community
    //      median.
    //
    // Glide path for future operator-count milestones (not yet
    // implemented — when we hit them we revisit):
    //   platform_operator_count >= 5  → cap rises to 35% platform
    //   platform_operator_count >= 10 → cap rises to 50% platform
    //   platform_operator_count >= 25 → cap rises to 60% platform
    const personalWeight =
      result.dataPoints >= 5 ? 0.85 :
      result.dataPoints >= 3 ? 0.80 :
      result.dataPoints >= 2 ? 0.78 :
      0.75;
    const blended = result.forecast * personalWeight + platformMedian * (1 - personalWeight);
    // Set platform fields BEFORE applyAdjustments so calculateConfidenceScore
    // can credit the community component. Setting them after was a silent
    // bug: blended forecasts skipped their community bonus.
    result.platformOperatorCount = platformOpCount;
    result.platformMedianSales = Math.round(platformMedian * 100) / 100;
    result.platformBlendApplied = true;
    const finalResult = applyAdjustments(result, target, validEvents, calibrated, venueHistory);
    finalResult.forecast = Math.round(blended * 100) / 100;
    return markInsufficientDataIfBelowFloor(finalResult, validEvents);
  }

  if (result) return markInsufficientDataIfBelowFloor(applyAdjustments(result, target, validEvents, calibrated, venueHistory), validEvents);

  // Level 0: Platform registry — no personal history but platform has enough operators
  if (platformMedian > 0 && platformOpCount >= 3) {
    const platformResult: ForecastResult = {
      level: 0,
      levelName: "Platform Registry",
      signal: "community",
      forecast: Math.round(platformMedian * 100) / 100,
      baseForecast: Math.round(platformMedian * 100) / 100,
      weatherCoefficient: null,
      weatherAdjustment: null,
      dayOfWeekCoefficient: null,
      dayOfWeekAdjustment: null,
      attendanceAdjustment: null,
      venueFamiliarityApplied: false,
      dataPoints: platformEvent?.total_instances ?? 0,
      // Placeholder — overwritten by score-based label in applyAdjustments.
      confidence: "LOW",
      confidenceScore: 0,
      calibrated: false,
      platformOperatorCount: platformOpCount,
      platformMedianSales: Math.round(platformMedian * 100) / 100,
      platformBlendApplied: true,
      insufficientData: false,
    };
    return markInsufficientDataIfBelowFloor(applyAdjustments(platformResult, target, validEvents, calibrated, venueHistory), validEvents);
  }

  // Level 2: Similar Event Combo (same type + city area)
  result = tryLevel2(target, validEvents);
  if (result) return markInsufficientDataIfBelowFloor(applyAdjustments(result, target, validEvents, calibrated, venueHistory), validEvents);

  // Level 3: Event Type Average
  result = tryLevel3(target, validEvents, calibrated);
  if (result) return markInsufficientDataIfBelowFloor(applyAdjustments(result, target, validEvents, calibrated, venueHistory), validEvents);

  // Level 4: Seasonal Monthly Average
  result = tryLevel4(target, validEvents, calibrated);
  if (result) return markInsufficientDataIfBelowFloor(applyAdjustments(result, target, validEvents, calibrated, venueHistory), validEvents);

  return null;
}

function makeResult(
  partial: Omit<ForecastResult, "confidenceScore" | "calibrated" | "venueFamiliarityApplied" | "platformBlendApplied" | "insufficientData">
): ForecastResult {
  return {
    ...partial,
    confidenceScore: 0,
    calibrated: false,
    venueFamiliarityApplied: false,
    platformBlendApplied: false,
    insufficientData: false,
  };
}

function tryLevel1(
  target: Partial<Event>,
  events: Event[],
  allEvents: Event[] // full unfiltered set — used for series day detection only
): ForecastResult | null {
  if (!target.event_name) return null;

  const nameNormalized = target.event_name.toLowerCase().trim();

  // Determine whether this event is part of a multi-day series.
  // We gather every date (from the full unfiltered list + the target itself)
  // so that cluster boundaries are computed correctly even for future events.
  const allDatesForName = [
    ...new Set([
      ...allEvents
        .filter((e) => e.event_name.toLowerCase().trim() === nameNormalized)
        .map((e) => e.event_date),
      ...(target.event_date ? [target.event_date] : []),
    ]),
  ].sort();

  const targetSeriesDay =
    target.event_date && allDatesForName.length >= 2
      ? getSeriesDay(target.event_date, allDatesForName)
      : null;

  // Filter historical events to those with recorded sales
  let matching = events.filter(
    (e) => e.event_name.toLowerCase().trim() === nameNormalized
  );

  if (matching.length < 1) return null;

  // If this is a multi-day series, restrict to the same day-of-series
  // so Shutterfest Day 1 doesn't average with Day 3, etc.
  if (targetSeriesDay !== null) {
    const sameDayMatches = matching.filter((e) => {
      const day = getSeriesDay(e.event_date, allDatesForName);
      return day === targetSeriesDay;
    });
    // Only narrow the set if we have at least 1 same-day data point;
    // otherwise fall through to the full set (graceful degradation).
    if (sameDayMatches.length >= 1) {
      matching = sameDayMatches;
    }
  }

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
    // Placeholder — overwritten by score-based label in applyAdjustments.
    confidence: "LOW",
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
    // Placeholder — overwritten by score-based label in applyAdjustments.
    confidence: "LOW",
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
    // Placeholder — overwritten by score-based label in applyAdjustments.
    confidence: "LOW",
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

  // Calculate numeric confidence score.
  // Tier is auto-derived from name-match history + consistency (see
  // deriveEventTier); the stored events.event_tier column is no longer
  // read for scoring. Community component reads result.platformOperatorCount
  // which is set by the L0/L1-blend paths.
  const matchingEvents = getMatchingEventsForLevel(result.level, target, allEvents);
  const derivedTier = target.event_name
    ? deriveEventTier(target.event_name, allEvents)
    : null;
  result.confidenceScore = calculateConfidenceScore(
    result.dataPoints,
    matchingEvents,
    isCalibrated,
    calculateConsistency(matchingEvents),
    result.venueFamiliarityApplied,
    derivedTier,
    result.platformOperatorCount ?? 0
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
      const byName = events.filter(
        (e) => e.event_name.toLowerCase().trim() === nameNormalized
      );
      // Apply series-day filtering if applicable (mirrors tryLevel1 logic)
      if (target.event_date && byName.length >= 2) {
        const allDatesForName = [
          ...new Set([
            ...byName.map((e) => e.event_date),
            target.event_date,
          ]),
        ].sort();
        const targetSeriesDay = getSeriesDay(target.event_date, allDatesForName);
        if (targetSeriesDay !== null) {
          const sameDayMatches = byName.filter((e) => {
            const day = getSeriesDay(e.event_date, allDatesForName);
            return day === targetSeriesDay;
          });
          if (sameDayMatches.length >= 1) return sameDayMatches;
        }
      }
      return byName;
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
  const sales = events.map((e) => eventRevenue(e));
  const mean = sales.reduce((a, b) => a + b, 0) / sales.length;
  if (mean === 0) return 0;
  const variance =
    sales.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sales.length;
  const stddev = Math.sqrt(variance);
  return Math.max(0, 1 - stddev / mean);
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
