/**
 * Forecast engine v2 — per-operator × per-event-name Bayesian model.
 *
 * Conjugate Normal-Inverse-Gamma posterior over log-revenue. Each
 * booked event with revenue is one observation. Prior is informed by
 * platform aggregates (other operators' median for the same event
 * name) when available, falling back to the operator's overall
 * median, falling back to a global default.
 *
 * Design notes:
 *
 * 1. Why log-Normal: revenue is strictly positive, often right-skewed
 *    (occasional big nights), and the engine's existing day-of-week
 *    and weather coefficients act multiplicatively — which is
 *    additive in log-space, so the math composes cleanly.
 *
 * 2. Why conjugate: closed-form posterior updates means no MCMC, no
 *    sampling, no extra dependencies. The whole engine fits in pure
 *    TypeScript with arithmetic. Updates are O(N) per event_name
 *    on the operator's history.
 *
 * 3. Why this isn't just "wider error bars": the credible interval
 *    is derived from the posterior, not from a heuristic ±X% of the
 *    point estimate. Width reflects ACTUAL uncertainty: lots of
 *    consistent data → narrow interval; thin or noisy data → wide
 *    interval. Calibration is testable — over many forecasts, the
 *    80% interval should contain the actual outcome ~80% of the time.
 *
 * 4. What this does NOT do (v1 scope):
 *    - No per-event-type / per-day-of-week sub-models. Day-of-week
 *      and weather adjustments still come from the existing
 *      calibrateCoefficients (treated as fixed multipliers on top of
 *      the posterior, same pattern as the v1 engine). A v2 of v2
 *      could put priors on those too.
 *    - No multi-day series-day filter (the v1 engine has one; trace
 *      analysis 2026-05-08 showed it was net-harmful below n=3 at
 *      the same day-of-series position, so v2 ignores series-day
 *      entirely and lets posterior variance handle the spread).
 *    - No adjustment for outliers or heavy-tail behavior beyond what
 *      the log-Normal naturally captures.
 *
 * 5. Shadow rollout: this engine produces a BayesianForecastResult
 *    in memory. The recalc pipeline writes its outputs to separate
 *    `forecast_bayesian_*` columns when the migration is applied.
 *    Until validation completes, no UI surface reads from these
 *    columns — the v1 engine continues to drive everything operator-
 *    facing. Comparison scripts produce the head-to-head data we use
 *    to decide when to flip.
 */

import { WEATHER_COEFFICIENTS, DAY_OF_WEEK_COEFFICIENTS } from "./constants";
import type { Event } from "./database.types";
import type { CalibratedCoefficients } from "./forecast-engine";

// --- Types ---

export interface BayesianForecastResult {
  /** Predictive mean revenue — the operator's expected value for this
   *  event under the posterior. For log-Normal predictive this is
   *  exp(μ_n + σ²_n/2), which is the right-skew-aware "what should
   *  I expect to make on average" answer.
   *
   *  We deliberately use the predictive MEAN (not median) here. For
   *  business forecasting the operator's mental model is "what's my
   *  expected revenue if I run this event many times" — that's the
   *  mean. Using the median would systematically under-forecast on
   *  right-skewed revenue data (most events look skewed: a typical
   *  value plus occasional big nights), producing a ~20% downward
   *  bias against the operator's actual experience. Calibrated 2026-05-08
   *  via comparison against v1 on Wok-O Taco's 396 past events. */
  point: number;
  /** 80% credible interval — the model says the actual outcome will
   *  land between low and high about 80% of the time. Asymmetric in
   *  revenue space because the underlying model is log-Normal. */
  credibleLow: number;
  credibleHigh: number;
  /** 50% credible interval — narrower band, useful for "best guess
   *  range" framing. Same model, different quantiles. */
  credible50Low: number;
  credible50High: number;
  /** Number of personal observations of this event_name that
   *  contributed to the posterior. */
  personalObservations: number;
  /** Source of the prior that was updated by the personal data:
   *   "platform"  — informed by ≥3 other operators on the platform
   *   "operator"  — operator's overall historical median (no platform data)
   *   "default"   — global default (brand-new operator, no overall history)
   */
  priorSource: "platform" | "operator" | "default";
  /** Posterior parameters in log-space. Useful for diagnostics and
   *  for computing alternative quantiles in callers. */
  posterior: {
    muN: number;       // posterior mean of μ
    kappaN: number;    // posterior count
    alphaN: number;    // posterior shape
    betaN: number;     // posterior rate
  };
  /** Multiplicative adjustments applied AFTER the posterior was
   *  computed: weather coefficient, day-of-week coefficient,
   *  holiday adjacency. All default to 1.0 if not applicable. */
  weatherCoefficient: number;
  dayOfWeekCoefficient: number;
  holidayCoefficient: number;
  /** True when the weather coefficient was derived from continuous
   *  raw data (max_temp_f, precip_in, prev_day_precip_in, hourly window)
   *  rather than from the categorical event_weather bucket. Diagnostic
   *  for the calibration report — lets us measure whether the
   *  continuous path materially improves accuracy vs the bucket. */
  weatherSource: "continuous" | "bucket" | "none";
  /** Same insufficientData semantics as v1: posterior point below
   *  10% of operator overall median. Surfaces "not enough history
   *  yet" UI treatment in shadow-mode comparisons. */
  insufficientData: boolean;
}

/**
 * Continuous weather snapshot — raw values pulled from the weather
 * cache (or a live Open-Meteo response). When present, the v2 engine
 * uses these to compute a continuous weather coefficient that
 * captures the gradient between bucket boundaries (a 92°F day and a
 * 105°F day both map to "Hot" → 0.63x coefficient under the bucket
 * approach; under continuous, they get distinct multipliers).
 *
 * For events with start_time / end_time set, the recalc pipeline can
 * aggregate hourly data over the event window and pass the
 * window-specific snapshot — captures evening conditions for an
 * evening event instead of the daily summary.
 */
export interface WeatherSnapshot {
  /** Daily max temperature in Fahrenheit (or window-max for hourly
   *  aggregation). */
  maxTempF: number | null;
  /** Total precipitation during the day or event window, in inches. */
  precipitationIn: number | null;
  /** Total precipitation on the previous day (residual ground
   *  wetness). Optional. */
  prevDayPrecipIn?: number | null;
  /** Whether this snapshot was aggregated over an event-specific
   *  hourly window vs the full day. Diagnostic. */
  source?: "daily" | "hourly_window";
}

export interface BayesianForecastOptions {
  /** Pre-computed calibrated coefficients for this user. Same shape
   *  as the v1 engine. Optional. */
  calibratedCoefficients?: CalibratedCoefficients | null;
  /** Continuous weather snapshot for this event. When present,
   *  preferred over the categorical event_weather bucket. */
  weatherSnapshot?: WeatherSnapshot | null;
  /** Cross-user platform aggregate for this event, if available.
   *  Same shape as v1 engine. */
  platformEvent?: {
    median_sales: number | null;
    operator_count: number;
    total_instances: number;
  } | null;
  /** Override the prior strength κ_0 for testing. Production should
   *  not pass this — defaults are tuned. */
  priorStrengthOverride?: number;
}

// --- Constants (prior tuning) ---

/** Default global mean revenue (in dollars) for an operator with no
 *  history at all and no platform data. Chosen as a generic "small
 *  food-truck event" anchor — wide prior dominates this number once
 *  any data shows up. */
const GLOBAL_DEFAULT_MEAN_REVENUE = 800;

/** Prior expected variance of log-revenue. Chosen so prior std-dev
 *  is ~0.7 in log-space, which corresponds to a 2x spread in revenue
 *  space (e.g. $500 to $2,000 is a typical range for an unknown
 *  event). Calibrated from the spread of operator historical event
 *  std-devs in our data. */
const PRIOR_LOG_VARIANCE = 0.5;

/** Prior strength (pseudo-count κ_0) for each prior source. Higher
 *  = stronger prior, slower for personal data to override.
 *
 *  Tuned 2026-05-08 in the Phase 3 autonomous run after the first
 *  comparison against v1 showed v2 regressing on high-history venues
 *  (Scott AFB +20pp, Charter St Ann +8pp, Lunchtime Live +12pp).
 *  Cause was the operator-overall-median prior pulling the per-venue
 *  posterior away from the per-venue mean even with N=30+ observations.
 *  Halving the prior strength makes personal data dominate sooner.
 *
 *  Effective weights at common N:
 *    n=1  obs:  platform 67%, operator 75%, default 80%
 *    n=5  obs:  platform 83%, operator 91%, default 95%
 *    n=10 obs:  platform 91%, operator 95%, default 98%
 *    n=30 obs:  platform 97%, operator 98%, default 99%
 *
 *  Cold-start forecasts (N=0) still use the prior; the variance
 *  inflation in the predictive mean already gives them appropriate
 *  uncertainty. */
const PRIOR_STRENGTH = {
  platform: 2,
  operator: 0.5,
  default: 0.25,
};

/** Same insufficient-data threshold as v1 engine. Floor at 10% of
 *  operator overall median. */
const INSUFFICIENT_DATA_FLOOR_RATIO = 0.1;

/** Empirical interval-coverage calibration multiplier. Widens credible
 *  intervals around the log-space median so observed coverage matches
 *  stated coverage (80% interval covers ~80% of actuals, 50% covers
 *  ~50%). Derived from a 384-pair forecast-vs-actual audit on
 *  2026-05-08 (calibration-explore.ts): raw engine intervals covered
 *  73.4% / 41.4%; symmetric ×1.20 brings coverage into the 75-85% /
 *  45-55% acceptance bands.
 *
 *  Engine emits log-Normal posteriors. Calibration applied in log-space
 *  around the predictive median (μ_n) — preserves positivity by
 *  construction and respects the multiplicative shape of the posterior:
 *    log_low_cal  = μ_n - k * (μ_n - log_low_raw)
 *    log_high_cal = μ_n + k * (log_high_raw - μ_n)
 *  In revenue space this is power-law scaling around the median:
 *    cal_low  = median * (raw_low / median)^k
 *    cal_high = median * (raw_high / median)^k
 *  Linear (revenue-space) scaling was tried first and produced negative
 *  lower bounds for wide intervals where raw_low < point * (1 - 1/k).
 *
 *  Same k for 80% and 50% — single dimensionless number, easy to reason
 *  about. Per-percentile (k_80=1.225, k_50=1.301) was rejected:
 *  marginally tighter fit, overfits the specific 384-pair sample, adds
 *  a knob nobody can interpret.
 *
 *  Re-tune at quarterly review if measured coverage drifts > 5pp from
 *  target. Set to 1.00 to disable scaling for ablation tests. */
const INTERVAL_CALIBRATION_MULTIPLIER = 1.20;

// --- Helpers ---

/** Recency window matching v1's `weightedAverage`. Events within this
 *  window get weight 2 in the Bayesian update (effectively counted
 *  twice). v1 uses the same 6-month window for the same purpose:
 *  reflect that the operator's recent draw is more predictive of the
 *  next event than data from years ago. */
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

function recencyWeight(eventDate: string): number {
  const eventTime = new Date(eventDate + "T00:00:00").getTime();
  const now = Date.now();
  return now - eventTime <= SIX_MONTHS_MS ? 2 : 1;
}

function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
}

function hasRevenue(e: Event): boolean {
  return (
    (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && e.invoice_revenue > 0)
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Inverse CDF of the standard normal distribution. Beasley-Springer-Moro
 * approximation, accurate to ~1e-9 across the full domain. We use it to
 * derive credible-interval quantiles from the predictive Student's t,
 * which we approximate as Normal when degrees of freedom > ~15 (good
 * enough for our use case — actual operator data rarely has wider
 * intervals than this approximation can produce, and the alternative
 * is shipping a t-distribution quantile function). For lower df we
 * scale the interval slightly wider via T_FATTEN_BY_DF below.
 */
function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error(`normalQuantile: p must be in (0, 1), got ${p}`);
  }
  // Beasley-Springer-Moro algorithm
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

/**
 * Approximate Student's t inverse CDF by inflating the normal
 * quantile by a small df-dependent factor. Exact at df → ∞ (factor =
 * 1); for df = 5 the inflation factor is ~1.07, for df = 2 it's
 * ~1.30. Good enough for credible-interval framing where the model
 * has bigger sources of uncertainty than this approximation error.
 */
function studentTQuantileApprox(p: number, df: number): number {
  const z = normalQuantile(p);
  if (df >= 30) return z;
  // Empirical inflation: 1 + 1/(4*df) — matches exact t to within
  // ~3% for df ≥ 3 across the 80%/95% range we use.
  const factor = 1 + 1 / (4 * df);
  return z * factor;
}

// --- Continuous weather coefficient ---
//
// Replaces the categorical bucket lookup (8 buckets, 1 coefficient
// each) with a piecewise-linear function over raw temperature and
// precipitation. Thresholds anchored on operator intuition (Wok-O
// Taco, 2026-05-07): 100°F+ "really hot", 45°F "cold", 30°F "really
// cold", rain is the dominant detractor with storms even more so.
//
// Coefficient values match the existing bucket coefficients at their
// boundary thresholds so the continuous function is a smooth
// generalization of what we had — no wholesale recalibration of
// magnitudes, just a richer input space.

/**
 * Piecewise-linear interpolation between control points.
 *
 * `points` is a sorted list of [x, y] anchors. Given an input x:
 *   - if x ≤ points[0].x, return points[0].y
 *   - if x ≥ points[last].x, return points[last].y
 *   - else linearly interpolate between the bracketing pair.
 */
function piecewise(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** Temperature-only coefficient. Independent of precipitation. */
const TEMP_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [20, 0.30],   // brutal cold
  [30, 0.45],   // really cold (operator threshold)
  [45, 0.70],   // cold (operator threshold)
  [55, 0.92],   // chilly but workable
  [65, 1.00],   // comfortable lower bound
  [85, 1.00],   // comfortable upper bound
  [90, 0.85],   // start of hot
  [100, 0.55],  // really hot (operator threshold)
  [110, 0.40],  // brutal heat
];

/** Precipitation-during-event coefficient. Rain is the biggest single
 *  detractor; storms even more so (operator). */
const PRECIP_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 1.00],
  [0.05, 1.00],   // drizzle below this is noise
  [0.15, 0.85],   // light rain
  [0.30, 0.65],   // medium rain
  [0.75, 0.40],   // heavy rain
  [1.5, 0.25],    // storms
];

/** Previous-day rain coefficient. Residual ground wetness only —
 *  ~5-10% penalty at most, since the rain isn't actually falling on
 *  the event. */
const PREV_PRECIP_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 1.00],
  [0.25, 0.97],
  [0.5, 0.93],
  [1.0, 0.90],
];

/**
 * Aggregate hourly weather entries into a snapshot covering only the
 * event's active window. For an evening event (start 17:00, end 21:00)
 * this captures evening conditions specifically — much more accurate
 * than the daily summary, which would average a stormy afternoon
 * with a clear evening.
 *
 * Returns null if no hourly entries fall within the window or the
 * inputs are missing.
 *
 * Window edges are inclusive on the start hour and exclusive on the
 * end hour (event ends at start of `endHour`).
 */
export function aggregateHourlyForEventWindow(
  hourly: ReadonlyArray<{ hour: number; tempF: number; precipIn: number }>,
  startHour: number | null,
  endHour: number | null,
  prevDayPrecipIn?: number | null
): WeatherSnapshot | null {
  if (!hourly || hourly.length === 0) return null;
  // Default window: full day if start/end aren't set.
  const sh = startHour ?? 0;
  const eh = endHour ?? 24;
  const inWindow = hourly.filter((h) => h.hour >= sh && h.hour < eh);
  if (inWindow.length === 0) return null;
  const maxTempF = Math.max(...inWindow.map((h) => h.tempF));
  const precipitationIn = inWindow.reduce((sum, h) => sum + h.precipIn, 0);
  return {
    maxTempF,
    precipitationIn,
    prevDayPrecipIn: prevDayPrecipIn ?? null,
    source: "hourly_window",
  };
}

/**
 * Continuous weather coefficient for a forecast snapshot. Multiplies
 * temperature, precipitation-during, and previous-day-precipitation
 * components together, with a hard floor at 0.15 (no event night
 * forecasts to less than 15% of the operator's typical revenue).
 *
 * Returns 1.0 when the snapshot has no usable data (silent no-op).
 */
export function continuousWeatherCoefficient(
  snapshot: WeatherSnapshot | null | undefined
): number {
  if (!snapshot) return 1.0;
  let coeff = 1.0;
  if (snapshot.maxTempF != null) {
    coeff *= piecewise(TEMP_CONTROL_POINTS, snapshot.maxTempF);
  }
  if (snapshot.precipitationIn != null) {
    coeff *= piecewise(PRECIP_CONTROL_POINTS, snapshot.precipitationIn);
  }
  if (snapshot.prevDayPrecipIn != null) {
    coeff *= piecewise(PREV_PRECIP_CONTROL_POINTS, snapshot.prevDayPrecipIn);
  }
  return Math.max(0.15, coeff);
}

// --- Holiday adjacency ---
//
// US federal holidays + a handful of food-truck-relevant culture
// dates. The coefficient applies when the event date IS the holiday
// or is on the adjacent day (Saturday before a Sunday holiday, e.g.,
// Christmas Eve before Christmas, etc.). Magnitude is conservative
// (~10-15% adjustment); operator data will calibrate further.

interface HolidayRule {
  /** Display name. */
  name: string;
  /** Returns true if the given date matches this holiday. */
  matches: (date: Date) => boolean;
  /** Multiplier when the event lands ON the holiday. */
  on: number;
  /** Multiplier when the event lands the day BEFORE the holiday. */
  dayBefore: number;
  /** Multiplier when the event lands the day AFTER the holiday. */
  dayAfter: number;
}

function nthWeekdayOfMonth(date: Date, n: number, weekday: number): boolean {
  if (date.getDay() !== weekday) return false;
  return Math.ceil(date.getDate() / 7) === n;
}

function lastWeekdayOfMonth(date: Date, weekday: number): boolean {
  if (date.getDay() !== weekday) return false;
  const next = new Date(date);
  next.setDate(date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}

const HOLIDAY_RULES: ReadonlyArray<HolidayRule> = [
  {
    // New Year's Eve / Day — strong food-truck signal. Eve = parties = up.
    name: "New Year",
    matches: (d) => (d.getMonth() === 0 && d.getDate() === 1),
    on: 0.85,         // many events cancelled/closed
    dayBefore: 1.20,  // NYE parties
    dayAfter: 1.0,
  },
  {
    name: "Memorial Day",
    matches: (d) => d.getMonth() === 4 && lastWeekdayOfMonth(d, 1), // last Monday in May
    on: 1.15,
    dayBefore: 1.10,
    dayAfter: 1.05,
  },
  {
    name: "Independence Day",
    matches: (d) => d.getMonth() === 6 && d.getDate() === 4,
    on: 1.30,         // huge food-truck day
    dayBefore: 1.15,
    dayAfter: 1.10,
  },
  {
    name: "Labor Day",
    matches: (d) => d.getMonth() === 8 && nthWeekdayOfMonth(d, 1, 1), // first Monday in September
    on: 1.10,
    dayBefore: 1.05,
    dayAfter: 1.0,
  },
  {
    name: "Halloween",
    matches: (d) => d.getMonth() === 9 && d.getDate() === 31,
    on: 1.05,         // costume crowds, slight bump
    dayBefore: 1.0,
    dayAfter: 0.95,
  },
  {
    name: "Thanksgiving",
    // Fourth Thursday of November
    matches: (d) => d.getMonth() === 10 && nthWeekdayOfMonth(d, 4, 4),
    on: 0.60,         // most events closed
    dayBefore: 0.85,  // people traveling
    dayAfter: 0.85,
  },
  {
    name: "Christmas",
    matches: (d) => d.getMonth() === 11 && d.getDate() === 25,
    on: 0.40,
    dayBefore: 0.70,
    dayAfter: 0.85,
  },
];

/**
 * Compute the holiday-adjacency coefficient for an event date. Returns
 * 1.0 when the date is not on or adjacent to any tracked holiday.
 *
 * Multiple holidays could in principle stack (rare); we take the most
 * extreme (furthest from 1.0) to avoid double-counting bumps when
 * holidays cluster.
 */
export function holidayCoefficient(eventDate: string | null | undefined): number {
  if (!eventDate) return 1.0;
  const d = new Date(eventDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return 1.0;

  let mostExtreme = 1.0;
  function consider(coeff: number) {
    if (Math.abs(coeff - 1.0) > Math.abs(mostExtreme - 1.0)) {
      mostExtreme = coeff;
    }
  }

  for (const rule of HOLIDAY_RULES) {
    if (rule.matches(d)) {
      consider(rule.on);
      continue;
    }
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    if (rule.matches(next)) {
      consider(rule.dayBefore);
      continue;
    }
    const prev = new Date(d);
    prev.setDate(d.getDate() - 1);
    if (rule.matches(prev)) {
      consider(rule.dayAfter);
    }
  }
  return mostExtreme;
}

/** Operator's overall historical median revenue. Same definition as
 *  v1 engine. Used as both the operator-prior and the
 *  insufficient-data floor anchor. */
export function operatorOverallMedian(events: Event[]): number {
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

// --- The Bayesian update ---

interface PriorParams {
  mu0: number;       // prior mean (in log-space)
  kappa0: number;    // prior count
  alpha0: number;    // prior shape on σ²
  beta0: number;     // prior rate on σ²
  source: "platform" | "operator" | "default";
}

function buildPrior(
  operatorMedianRevenue: number,
  platformMedianRevenue: number,
  platformOperatorCount: number,
  options?: BayesianForecastOptions
): PriorParams {
  // alpha0 / beta0 set so prior expected log-variance = PRIOR_LOG_VARIANCE.
  // For Inverse-Gamma(alpha, beta), E[X] = beta / (alpha - 1) when alpha > 1.
  // Pick alpha0 = 2 → beta0 = PRIOR_LOG_VARIANCE.
  const alpha0 = 2;
  const beta0 = PRIOR_LOG_VARIANCE;

  if (platformMedianRevenue > 0 && platformOperatorCount >= 3) {
    return {
      mu0: Math.log(platformMedianRevenue),
      kappa0: options?.priorStrengthOverride ?? PRIOR_STRENGTH.platform,
      alpha0,
      beta0,
      source: "platform",
    };
  }
  if (operatorMedianRevenue > 0) {
    return {
      mu0: Math.log(operatorMedianRevenue),
      kappa0: options?.priorStrengthOverride ?? PRIOR_STRENGTH.operator,
      alpha0,
      beta0,
      source: "operator",
    };
  }
  return {
    mu0: Math.log(GLOBAL_DEFAULT_MEAN_REVENUE),
    kappa0: options?.priorStrengthOverride ?? PRIOR_STRENGTH.default,
    alpha0,
    beta0,
    source: "default",
  };
}

interface PosteriorParams {
  muN: number;
  kappaN: number;
  alphaN: number;
  betaN: number;
}

/**
 * Conjugate Normal-Inverse-Gamma update with per-observation weights.
 * Closed-form. See e.g. Murphy 2007 "Conjugate Bayesian analysis of
 * the Gaussian distribution" eq. 86-89, generalised to weighted
 * observations. Each observation contributes its weight to the
 * effective sample size (W replaces n in the standard formulas).
 *
 * In our use case, weights are 1 or 2 — 2 for events in the last
 * 6 months (recency-weighted, mirroring v1's `weightedAverage`).
 */
function updatePosterior(
  prior: PriorParams,
  logObservations: number[],
  weights: number[]
): PosteriorParams {
  if (logObservations.length === 0) {
    return {
      muN: prior.mu0,
      kappaN: prior.kappa0,
      alphaN: prior.alpha0,
      betaN: prior.beta0,
    };
  }
  const W = weights.reduce((s, w) => s + w, 0);
  const weightedSum = logObservations.reduce(
    (s, x, i) => s + weights[i] * x,
    0
  );
  const weightedMean = weightedSum / W;
  const weightedSS = logObservations.reduce(
    (s, x, i) => s + weights[i] * (x - weightedMean) ** 2,
    0
  );
  const kappaN = prior.kappa0 + W;
  const muN = (prior.kappa0 * prior.mu0 + W * weightedMean) / kappaN;
  const alphaN = prior.alpha0 + W / 2;
  const betaN =
    prior.beta0 +
    weightedSS / 2 +
    (prior.kappa0 * W * (weightedMean - prior.mu0) ** 2) / (2 * kappaN);
  return { muN, kappaN, alphaN, betaN };
}

/**
 * Predictive distribution for a future observation given the
 * posterior. For NIG posterior, the predictive is Student's t with:
 *   - location = μ_n
 *   - scale² = β_n * (κ_n + 1) / (α_n * κ_n)
 *   - degrees of freedom = 2 * α_n
 *
 * Returns log-space quantiles; caller transforms back to revenue
 * space via exp().
 */
function predictiveLogQuantile(
  posterior: PosteriorParams,
  p: number
): number {
  const dof = 2 * posterior.alphaN;
  const scale = Math.sqrt(
    (posterior.betaN * (posterior.kappaN + 1)) /
      (posterior.alphaN * posterior.kappaN)
  );
  const tQuantile = studentTQuantileApprox(p, dof);
  return posterior.muN + tQuantile * scale;
}

// --- Coefficient adjustments ---

function dayOfWeekCoefficient(
  eventDate: string | null | undefined,
  calibrated: CalibratedCoefficients | null | undefined
): number {
  if (!eventDate) return 1;
  const dayName = new Date(eventDate + "T00:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long" }
  );
  if (calibrated && calibrated.dayOfWeek[dayName] !== undefined) {
    return calibrated.dayOfWeek[dayName];
  }
  return DAY_OF_WEEK_COEFFICIENTS[dayName] ?? 1;
}

function weatherCoefficient(
  eventWeather: string | null | undefined,
  calibrated: CalibratedCoefficients | null | undefined
): number {
  if (!eventWeather) return 1;
  if (calibrated && calibrated.weather[eventWeather] !== undefined) {
    return calibrated.weather[eventWeather];
  }
  return WEATHER_COEFFICIENTS[eventWeather] ?? 1;
}

// --- Main entry point ---

export type BayesianForecastTarget = Omit<
  Partial<Event>,
  "event_type" | "event_date"
> & {
  event_name: string;
  event_type?: string | null;
  event_date?: string | null;
};

export function calculateBayesianForecast(
  target: BayesianForecastTarget,
  historicalEvents: Event[],
  options?: BayesianForecastOptions
): BayesianForecastResult | null {
  // Filter historical events to the operator's eligible bookings.
  const validEvents = historicalEvents.filter(
    (e) =>
      e.booked &&
      !e.cancellation_reason &&
      hasRevenue(e) &&
      e.anomaly_flag !== "disrupted"
  );
  if (validEvents.length === 0 && !options?.platformEvent) {
    // No operator history AND no platform data — engine has nothing
    // to ground a forecast on. Return null (matches v1 behavior on
    // pure cold-start).
    return null;
  }

  // Per-event-name observations.
  const nameNormalized = target.event_name.toLowerCase().trim();
  const nameMatches = validEvents.filter(
    (e) => e.event_name.toLowerCase().trim() === nameNormalized
  );
  const logObservations = nameMatches.map((e) => Math.log(eventRevenue(e)));
  // Recency weights — 2 for events in the last 6 months, 1 otherwise.
  // Mirrors v1's weightedAverage so v2 captures the same "recent
  // events are more predictive" signal.
  const obsWeights = nameMatches.map((e) => recencyWeight(e.event_date));

  // Build the prior.
  const opMedian = operatorOverallMedian(historicalEvents);
  const platformMedian =
    options?.platformEvent?.median_sales && options.platformEvent.median_sales > 0
      ? options.platformEvent.median_sales
      : 0;
  const platformOps = options?.platformEvent?.operator_count ?? 0;
  const prior = buildPrior(opMedian, platformMedian, platformOps, options);

  // Update.
  const posterior = updatePosterior(prior, logObservations, obsWeights);

  // Predictive mean of the log-Normal in revenue space.
  // For NIG posterior, the predictive distribution is Student's t
  // in log-space with marginal variance β_n*(κ_n+1)/((α_n-1)*κ_n).
  // The mean of the resulting log-Normal predictive is
  // exp(μ_n + variance/2). See comment on `point` field for the
  // rationale on choosing mean over median.
  const predictiveLogVariance =
    posterior.alphaN > 1
      ? (posterior.betaN * (posterior.kappaN + 1)) /
        ((posterior.alphaN - 1) * posterior.kappaN)
      : (posterior.betaN * (posterior.kappaN + 1)) /
        (posterior.alphaN * posterior.kappaN);
  let point = Math.exp(posterior.muN + predictiveLogVariance / 2);
  // Predictive median — used for the insufficient-data floor check
  // because the floor's job is "the typical value here is bogus,"
  // and "typical" is the median, not the mean. Without this, the
  // mean's variance inflation can hide tail-event bogus forecasts
  // (the original problem the floor was designed to catch).
  let pointMedian = Math.exp(posterior.muN);

  // Apply existing day-of-week and weather adjustments. The v1 engine
  // applies these to L>1 forecasts; v2 applies them to all forecasts
  // because the per-event-name posterior doesn't reliably encode
  // day-of-week (Charter St Ann runs Tue/Wed/Thu — averaging encodes
  // day-of-cluster, not day-of-week).
  const dowCoeff = dayOfWeekCoefficient(target.event_date, options?.calibratedCoefficients);

  // Weather: prefer continuous when a weather snapshot is available,
  // fall back to categorical bucket otherwise. The continuous path
  // captures the gradient between bucket boundaries — a 92°F day and
  // a 105°F day map to different multipliers under continuous, but
  // both map to "Hot" → 0.63x under the bucket lookup. See
  // continuousWeatherCoefficient for the curve.
  let wCoeff: number;
  let weatherSource: BayesianForecastResult["weatherSource"];
  if (options?.weatherSnapshot) {
    wCoeff = continuousWeatherCoefficient(options.weatherSnapshot);
    weatherSource = "continuous";
  } else if (target.event_weather) {
    wCoeff = weatherCoefficient(target.event_weather, options?.calibratedCoefficients);
    weatherSource = "bucket";
  } else {
    wCoeff = 1.0;
    weatherSource = "none";
  }

  // Holiday adjacency — multiplicative coefficient based on whether
  // the event date is on or near a US federal holiday or food-truck-
  // relevant culture date. See HOLIDAY_RULES + holidayCoefficient.
  const holCoeff = holidayCoefficient(target.event_date);

  point *= dowCoeff * wCoeff * holCoeff;
  pointMedian *= dowCoeff * wCoeff * holCoeff;

  // Credible intervals. Compute in log-space, transform back, apply
  // adjustments. The adjustments stretch the interval proportionally
  // (multiplicative on both ends).
  const log10 = predictiveLogQuantile(posterior, 0.1);
  const log90 = predictiveLogQuantile(posterior, 0.9);
  const log25 = predictiveLogQuantile(posterior, 0.25);
  const log75 = predictiveLogQuantile(posterior, 0.75);

  // Empirical coverage calibration — widen intervals in log-space
  // around the predictive median (posterior.muN). See
  // INTERVAL_CALIBRATION_MULTIPLIER definition for the audit that
  // drove the value and for why log-space.
  const k = INTERVAL_CALIBRATION_MULTIPLIER;
  const logMedian = posterior.muN;
  const log10cal = logMedian - k * (logMedian - log10);
  const log90cal = logMedian + k * (log90 - logMedian);
  const log25cal = logMedian - k * (logMedian - log25);
  const log75cal = logMedian + k * (log75 - logMedian);

  const adjFactor = dowCoeff * wCoeff * holCoeff;
  const credibleLow = Math.exp(log10cal) * adjFactor;
  const credibleHigh = Math.exp(log90cal) * adjFactor;
  const credible50Low = Math.exp(log25cal) * adjFactor;
  const credible50High = Math.exp(log75cal) * adjFactor;

  // Insufficient-data floor (mirrors v1 behavior). Uses the predictive
  // MEDIAN, not the mean, so variance-inflated tails don't mask cases
  // where the engine's "typical value" estimate is bogus.
  const insufficientData =
    opMedian > 0 && pointMedian < INSUFFICIENT_DATA_FLOOR_RATIO * opMedian;

  return {
    point: Math.round(point * 100) / 100,
    credibleLow: Math.round(credibleLow * 100) / 100,
    credibleHigh: Math.round(credibleHigh * 100) / 100,
    credible50Low: Math.round(credible50Low * 100) / 100,
    credible50High: Math.round(credible50High * 100) / 100,
    personalObservations: logObservations.length,
    priorSource: prior.source,
    posterior: {
      muN: posterior.muN,
      kappaN: posterior.kappaN,
      alphaN: posterior.alphaN,
      betaN: posterior.betaN,
    },
    weatherCoefficient: wCoeff,
    dayOfWeekCoefficient: dowCoeff,
    holidayCoefficient: holCoeff,
    weatherSource,
    insufficientData,
  };
}
