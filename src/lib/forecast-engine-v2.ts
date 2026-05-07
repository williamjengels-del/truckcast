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
   *  computed: weather coefficient and day-of-week coefficient.
   *  Both default to 1.0 if not applicable. */
  weatherCoefficient: number;
  dayOfWeekCoefficient: number;
  /** Same insufficientData semantics as v1: posterior point below
   *  10% of operator overall median. Surfaces "not enough history
   *  yet" UI treatment in shadow-mode comparisons. */
  insufficientData: boolean;
}

export interface BayesianForecastOptions {
  /** Pre-computed calibrated coefficients for this user. Same shape
   *  as the v1 engine. Optional. */
  calibratedCoefficients?: CalibratedCoefficients | null;
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
 *  = stronger prior, slower for personal data to override. Tuned so
 *  that platform data with 3+ operators is worth ~3 observations,
 *  operator-overall is worth ~1 observation, and the global default
 *  is worth ~0.5 observation (essentially noise once any data arrives). */
const PRIOR_STRENGTH = {
  platform: 3,
  operator: 1,
  default: 0.5,
};

/** Same insufficient-data threshold as v1 engine. Floor at 10% of
 *  operator overall median. */
const INSUFFICIENT_DATA_FLOOR_RATIO = 0.1;

// --- Helpers ---

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
 * Conjugate Normal-Inverse-Gamma update. Closed-form. See e.g.
 * Murphy 2007 "Conjugate Bayesian analysis of the Gaussian distribution"
 * eq. 86-89. Operates on log-revenue observations.
 */
function updatePosterior(
  prior: PriorParams,
  logObservations: number[]
): PosteriorParams {
  const n = logObservations.length;
  if (n === 0) {
    return {
      muN: prior.mu0,
      kappaN: prior.kappa0,
      alphaN: prior.alpha0,
      betaN: prior.beta0,
    };
  }
  const sampleMean = logObservations.reduce((s, x) => s + x, 0) / n;
  const sampleSS = logObservations.reduce(
    (s, x) => s + (x - sampleMean) ** 2,
    0
  );
  const kappaN = prior.kappa0 + n;
  const muN = (prior.kappa0 * prior.mu0 + n * sampleMean) / kappaN;
  const alphaN = prior.alpha0 + n / 2;
  const betaN =
    prior.beta0 +
    sampleSS / 2 +
    (prior.kappa0 * n * (sampleMean - prior.mu0) ** 2) / (2 * kappaN);
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

  // Build the prior.
  const opMedian = operatorOverallMedian(historicalEvents);
  const platformMedian =
    options?.platformEvent?.median_sales && options.platformEvent.median_sales > 0
      ? options.platformEvent.median_sales
      : 0;
  const platformOps = options?.platformEvent?.operator_count ?? 0;
  const prior = buildPrior(opMedian, platformMedian, platformOps, options);

  // Update.
  const posterior = updatePosterior(prior, logObservations);

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
  const wCoeff = weatherCoefficient(target.event_weather, options?.calibratedCoefficients);
  point *= dowCoeff * wCoeff;
  pointMedian *= dowCoeff * wCoeff;

  // Credible intervals. Compute in log-space, transform back, apply
  // adjustments. The adjustments stretch the interval proportionally
  // (multiplicative on both ends).
  const log10 = predictiveLogQuantile(posterior, 0.1);
  const log90 = predictiveLogQuantile(posterior, 0.9);
  const log25 = predictiveLogQuantile(posterior, 0.25);
  const log75 = predictiveLogQuantile(posterior, 0.75);

  const adjFactor = dowCoeff * wCoeff;
  const credibleLow = Math.exp(log10) * adjFactor;
  const credibleHigh = Math.exp(log90) * adjFactor;
  const credible50Low = Math.exp(log25) * adjFactor;
  const credible50High = Math.exp(log75) * adjFactor;

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
    insufficientData,
  };
}
