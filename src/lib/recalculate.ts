import { createClient } from "@/lib/supabase/server";
import { calculateEventPerformance } from "@/lib/event-performance";
import {
  calculateForecast,
  calibrateCoefficients,
  type ForecastResult,
} from "@/lib/forecast-engine";
import {
  calculateBayesianForecast,
  aggregateHourlyForEventWindow,
  type BayesianForecastResult,
  type WeatherSnapshot,
} from "@/lib/forecast-engine-v2";
import {
  updatePlatformRegistry,
  getPlatformEventsExcludingUser,
} from "@/lib/platform-registry";
import {
  autoClassifyWeather,
  getHourlyWeatherForEvent,
  type HourlyWeatherEntry,
} from "@/lib/weather";
import {
  inferTier,
  computeVenueMediansForTierInference,
  type EventSizeTier,
} from "@/lib/event-size-tier";
import type { Event, WeatherType } from "@/lib/database.types";

/**
 * Server-side recalculation of event performance and forecasts.
 * Called after any event mutation (create, update, delete).
 *
 * Pass `suppliedClient` from contexts where a service-role client is
 * required (Toast email inbound, POS cron, admin routes that mutate
 * another operator's data). Without it, a cookie-scoped client is
 * created — appropriate for the calling user's own mutations.
 *
 * Either way, all queries are `.eq("user_id", userId)` so the same
 * pipeline runs through cookie + service paths. Keep this single
 * source of truth — the route + service wrappers should not diverge.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recalculateForUser(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suppliedClient?: any
): Promise<{
  forecastsUpdated: number;
  performanceUpdated: number;
  weatherClassified: number;
  /** Number of v2 (Bayesian) shadow writes that succeeded. Will be 0
   *  when the shadow-columns migration hasn't been applied yet —
   *  not an error, just a signal that v2 isn't running yet. */
  bayesianShadowWritten: number;
  /** Number of past events that had `event_size_tier_inferred` written
   *  this run. Will be 0 when the tier columns migration hasn't been
   *  applied yet (paste-at-merge gate, same pattern as v2). */
  tiersInferred: number;
}> {
  const supabase = suppliedClient ?? (await createClient());

  // Probe for optional column families that depend on paste-at-merge
  // migrations. Probe once per recalc rather than failing per event.
  // Same pattern: when the migration applies, the next recalc auto-
  // detects and starts populating the columns.
  const v2Available = await probeBayesianShadowColumns(supabase);
  const tierColumnsAvailable = await probeEventSizeTierColumns(supabase);

  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);

  const allEvents = (events ?? []) as Event[];

  // Get unique event names with revenue (net_sales OR catering invoice)
  const eventNames = [
    ...new Set(
      allEvents
        .filter(
          (e) =>
            e.booked &&
            ((e.net_sales !== null && e.net_sales > 0) ||
              (e.event_mode === "catering" && e.invoice_revenue > 0))
        )
        .map((e) => e.event_name)
    ),
  ];

  // Recalculate per-user event performance
  for (const eventName of eventNames) {
    const perf = calculateEventPerformance(eventName, userId, allEvents);
    await supabase.from("event_performance").upsert(
      perf as Record<string, unknown>,
      { onConflict: "user_id,event_name" }
    );
  }

  // Update platform registry with cross-user aggregates — fire and
  // forget (non-blocking, intentional). Log on failure so persistent
  // registry write breakage shows up in Cloudflare logs instead of
  // disappearing silently. Don't surface to the user — recalc is
  // user-facing, registry is best-effort cross-operator data.
  updatePlatformRegistry(eventNames).catch((e) => {
    console.warn("[recalculate] platform registry update failed:", e);
  });

  // Calibrate per-user coefficients from historical data
  const calibrated = calibrateCoefficients(allEvents);

  // Auto-classify weather for near-term events (within 16 days) that don't have it set
  const today = new Date().toISOString().split("T")[0];
  const in16Days = new Date();
  in16Days.setDate(in16Days.getDate() + 16);
  const in16DaysStr = in16Days.toISOString().split("T")[0];

  const nearTermEvents = allEvents.filter(
    (e) => e.event_date >= today && e.event_date <= in16DaysStr && !e.event_weather && (e.city || e.location)
  );
  const weatherUpdates = new Map<string, WeatherType>();
  for (const event of nearTermEvents) {
    const cityStr = (event.city || event.location || "").trim();
    if (!cityStr) continue;
    try {
      // Pass state to disambiguate the geocoder when the operator's
      // event has a state set. Without this, ambiguous city names
      // (Bellville, Madison, etc.) silently picked the highest-
      // population result regardless of state — bug surfaced 2026-05-07
      // weather audit. Falls through to country-wide pick when state
      // is null (legacy events created before the form-level state
      // default).
      const result = await autoClassifyWeather(
        cityStr,
        event.event_date,
        supabase,
        event.state ?? null
      );
      if (result) {
        await supabase.from("events").update({ event_weather: result.classification }).eq("id", event.id);
        weatherUpdates.set(event.id, result.classification);
      }
    } catch { /* non-critical */ }
  }
  for (const event of allEvents) {
    if (weatherUpdates.has(event.id)) {
      event.event_weather = weatherUpdates.get(event.id)!;
    }
  }

  // Fetch platform event data for booked upcoming event names (for Level 0 blending)
  const bookedUpcoming = allEvents.filter((e) => e.event_date >= today && e.booked);
  const upcomingNames = [...new Set(bookedUpcoming.map((e) => e.event_name))];
  // Self-excluding aggregate (operator-notes Q2): the engine's blend
  // shouldn't regress toward this operator's own mean.
  const platformMap = await getPlatformEventsExcludingUser(
    upcomingNames,
    userId
  ).catch(() => new Map<string, import("@/lib/database.types").PlatformEvent>());

  // Recalculate forecasts for ALL future events — booked AND unbooked
  const futureEvents = allEvents.filter((e) => e.event_date >= today);
  let forecastsUpdated = 0;
  let bayesianShadowWritten = 0;
  for (const event of futureEvents) {
    const platformEvent = event.booked
      ? (platformMap.get(event.event_name.toLowerCase().trim()) ?? null)
      : null;
    const result = calculateForecast(event, allEvents, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    if (result) {
      const update = forecastUpdate(result);
      let v2: BayesianForecastResult | null = null;
      if (v2Available) {
        const weatherSnapshot = await fetchWeatherSnapshot(supabase, event);
        v2 = calculateBayesianForecast(event, allEvents, {
          calibratedCoefficients: calibrated,
          platformEvent,
          weatherSnapshot,
        });
        if (v2) {
          Object.assign(update, bayesianShadowUpdate(v2));
          bayesianShadowWritten++;
        }
      }
      await supabase.from("events").update(update).eq("id", event.id);
      forecastsUpdated++;
    }
  }

  // Backfill past events that either lack a forecast entirely OR have a
  // forecast_sales value but null range bounds. The range-null branch
  // catches rows forecasted before forecast_low/_high writes existed —
  // without this, ForecastVsActual silently falls back to plain variance
  // (no within/below/above-range qualifier) on those older rows.
  const pastEventsNeedingForecast = allEvents.filter(
    (e) =>
      e.event_date < today &&
      e.booked &&
      ((e.net_sales !== null && e.net_sales > 0) ||
        (e.event_mode === "catering" && e.invoice_revenue > 0)) &&
      (e.forecast_sales === null ||
        e.forecast_low === null ||
        e.forecast_high === null) &&
      e.anomaly_flag !== "disrupted"
  );

  for (const event of pastEventsNeedingForecast) {
    // Use all events EXCEPT this one as historical context (simulate pre-event state)
    const historicalWithout = allEvents.filter((e) => e.id !== event.id);
    const result = calculateForecast(event, historicalWithout, {
      calibratedCoefficients: calibrated,
    });
    if (result) {
      const update = forecastUpdate(result);
      if (v2Available) {
        const weatherSnapshot = await fetchWeatherSnapshot(supabase, event);
        const v2 = calculateBayesianForecast(event, historicalWithout, {
          calibratedCoefficients: calibrated,
          weatherSnapshot,
        });
        if (v2) {
          Object.assign(update, bayesianShadowUpdate(v2));
          bayesianShadowWritten++;
        }
      }
      await supabase.from("events").update(update).eq("id", event.id);
      forecastsUpdated++;
    }
  }

  // Past events that ALREADY have v1 forecasts but might be missing v2
  // shadow values (e.g. first recalc after the migration applied).
  // Backfills the v2-only state without re-touching v1 — operator's
  // accuracy lines stay stable across the rollout.
  if (v2Available) {
    const pastEventsMissingV2 = allEvents.filter(
      (e) =>
        e.event_date < today &&
        e.booked &&
        ((e.net_sales !== null && e.net_sales > 0) ||
          (e.event_mode === "catering" && e.invoice_revenue > 0)) &&
        e.forecast_bayesian_point == null &&
        e.anomaly_flag !== "disrupted"
    );
    for (const event of pastEventsMissingV2) {
      const historicalWithout = allEvents.filter((e) => e.id !== event.id);
      const weatherSnapshot = await fetchWeatherSnapshot(supabase, event);
      const v2 = calculateBayesianForecast(event, historicalWithout, {
        calibratedCoefficients: calibrated,
        weatherSnapshot,
      });
      if (v2) {
        await supabase
          .from("events")
          .update(bayesianShadowUpdate(v2))
          .eq("id", event.id);
        bayesianShadowWritten++;
      }
    }
  }

  // Event size tier — populate event_size_tier_inferred for past events
  // with actuals. Foundation pass: writes the column but the engine
  // doesn't read tier yet (PR 3 will add the partition logic). Backfills
  // every past event with revenue on each recalc so threshold tweaks
  // propagate without requiring a separate one-shot script.
  let tiersInferred = 0;
  if (tierColumnsAvailable) {
    const venueMedians = computeVenueMediansForTierInference(allEvents, today);
    const pastEventsForTier = allEvents.filter(
      (e) =>
        e.event_date < today &&
        e.booked &&
        ((e.net_sales !== null && e.net_sales > 0) ||
          (e.event_mode === "catering" && e.invoice_revenue > 0)) &&
        e.anomaly_flag !== "disrupted" &&
        e.anomaly_flag !== "boosted"
    );
    const computedAt = new Date().toISOString();
    for (const event of pastEventsForTier) {
      const revenue =
        event.event_mode === "catering"
          ? event.invoice_revenue ?? 0
          : event.net_sales ?? 0;
      const venueMedian = venueMedians.get(event.event_name.toLowerCase().trim());
      const tier: EventSizeTier | null = inferTier(revenue, venueMedian);
      // Only update when the inferred value would change. Avoids
      // pointless writes (and updated_at churn) on stable rows.
      if (tier !== null && tier !== event.event_size_tier_inferred) {
        await supabase
          .from("events")
          .update({
            event_size_tier_inferred: tier,
            event_size_tier_inferred_at: computedAt,
          })
          .eq("id", event.id);
        tiersInferred++;
      }
    }
  }

  return {
    forecastsUpdated,
    performanceUpdated: eventNames.length,
    weatherClassified: weatherUpdates.size,
    bayesianShadowWritten,
    tiersInferred,
  };
}

/**
 * Derive a forecast range (low / high) from the point forecast and confidence score.
 *
 * Recalibrated 2026-05-07 from ±15/±25/±40 to ±30/±50/±80 based on
 * audit of 396 forecast/actual pairs across 5 years of operator data
 * (scripts/audit-forecast-accuracy.mjs).
 *
 * The original bands produced ranges that caught only ~30% of forecasts
 * in their stated range — engine was overconfident across the board.
 * Recalibrated bands aim to honestly reflect observed variance:
 *
 *   HIGH   (score ≥ 0.65): ±30%  — was ±15%; catches ~30% at p30 of |miss|
 *   MEDIUM (score ≥ 0.40): ±50%  — was ±25%; catches ~50% at p50 of |miss|
 *   LOW    (score < 0.40): ±80%  — was ±40%; catches ~70% at p70 of |miss|
 *
 * Wider ranges read as less precise, but they're an honest reflection
 * of how well VendCast can predict real operator events. Tighter bands
 * that lie often are worse than wider bands that include reality.
 *
 * Underlying issue (queued for future engine work, not this PR): HIGH
 * confidence events are not actually more accurate than MEDIUM/LOW.
 * The confidence-score → range-pct mapping treats the buckets as
 * monotonically tighter, but observed accuracy is approximately flat
 * across buckets. Real fix is rebuilding the confidence score; widening
 * bands is the honest interim.
 */
function forecastRange(forecast: number, confidenceScore: number): { low: number; high: number } {
  const pct = confidenceScore >= 0.65 ? 0.30 : confidenceScore >= 0.4 ? 0.50 : 0.80;
  return {
    low:  Math.round(forecast * (1 - pct) * 100) / 100,
    high: Math.round(forecast * (1 + pct) * 100) / 100,
  };
}

/**
 * Build the events-row update payload for a forecast result.
 *
 * Two branches:
 *
 *   1. insufficientData=true — the engine produced a number it
 *      doesn't believe (final forecast below 10% of operator's
 *      historical median, see INSUFFICIENT_DATA_FLOOR_RATIO in
 *      forecast-engine.ts). Clear all four forecast columns to
 *      null so:
 *        - past-event ForecastVsActual line renders nothing
 *          (instead of "$2 forecast / $286 actual / +15,443%")
 *        - dashboard rolling hit-rate stat correctly excludes
 *          the row (its eligibility filter requires forecast_sales
 *          > 0)
 *        - the audit script's eligibility filter does the same
 *      Live-forecast UI surfaces (forecast-card) read the engine
 *      result directly and branch on insufficientData themselves
 *      to show "not enough history yet" copy.
 *
 *   2. else — write the forecast value and the score-derived
 *      low/high band, same as before this change.
 *
 * Note: writing forecast_confidence=null in the insufficientData
 * branch instead of a new "INSUFFICIENT_DATA" CHECK-constraint
 * value keeps the change schema-free. The original engine-fix
 * brief proposed introducing an INSUFFICIENT_DATA label; we
 * deferred it because expanding the CHECK constraint requires
 * a migration paste-at-merge step, and the brief explicitly
 * forbids shipping features that depend on a pending migration.
 * If a categorical label is wanted later, add it via a migration
 * in a follow-up PR.
 */
function forecastUpdate(result: ForecastResult): {
  forecast_sales: number | null;
  forecast_low: number | null;
  forecast_high: number | null;
  forecast_confidence: "HIGH" | "MEDIUM" | "LOW" | null;
} {
  if (result.insufficientData) {
    return {
      forecast_sales: null,
      forecast_low: null,
      forecast_high: null,
      forecast_confidence: null,
    };
  }
  const { low, high } = forecastRange(result.forecast, result.confidenceScore);
  return {
    forecast_sales: result.forecast,
    forecast_low: low,
    forecast_high: high,
    forecast_confidence: result.confidence,
  };
}

/**
 * Build the Bayesian shadow-column update payload. Mirrors
 * forecastUpdate but writes to the v2-shadow columns added by
 * migration 20260508000001. The point estimate is left non-null
 * even when insufficientData fires — UI consumers (when v2 eventually
 * becomes the read path) will branch on forecast_bayesian_insufficient
 * to decide whether to show the value or the "not enough history" copy.
 * This is different from v1's behavior of nulling forecast_sales when
 * insufficient; we keep more diagnostic data in shadow so the
 * calibration report can audit the floor's behavior over time.
 */
export function bayesianShadowUpdate(v2: BayesianForecastResult): {
  forecast_bayesian_point: number;
  forecast_bayesian_low_80: number;
  forecast_bayesian_high_80: number;
  forecast_bayesian_low_50: number;
  forecast_bayesian_high_50: number;
  forecast_bayesian_n_obs: number;
  forecast_bayesian_prior_src: "platform" | "operator" | "default";
  forecast_bayesian_insufficient: boolean;
  forecast_bayesian_computed_at: string;
} {
  return {
    forecast_bayesian_point: v2.point,
    forecast_bayesian_low_80: v2.credibleLow,
    forecast_bayesian_high_80: v2.credibleHigh,
    forecast_bayesian_low_50: v2.credible50Low,
    forecast_bayesian_high_50: v2.credible50High,
    forecast_bayesian_n_obs: v2.personalObservations,
    forecast_bayesian_prior_src: v2.priorSource,
    forecast_bayesian_insufficient: v2.insufficientData,
    forecast_bayesian_computed_at: new Date().toISOString(),
  };
}

/**
 * Detect whether the Bayesian shadow-column migration has been
 * applied. Probes the events table with a SELECT for one of the
 * new columns; PostgreSQL returns an "undefined column" error
 * when the column doesn't exist, which Supabase surfaces as a
 * 42703 error. Any error → assume not available, skip v2 writes
 * for this recalc cycle.
 *
 * Cached per recalculateForUser call (one probe per recalc, not
 * per event). When the migration applies, the next recalc auto-
 * detects and starts populating v2.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function probeBayesianShadowColumns(supabase: any): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("events")
      .select("forecast_bayesian_point")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Detect whether the event-size-tier migration has been applied. Same
 * pattern as probeBayesianShadowColumns — paste-at-merge gate. Until
 * the migration runs, tier writes would 42703 against the missing
 * column and we skip the tier pass entirely. After the migration
 * applies, the next recalc auto-detects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function probeEventSizeTierColumns(supabase: any): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("events")
      .select("event_size_tier_inferred")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Parse "HH:MM:SS" or "HH:MM" to a 0-23 hour. Returns null if
 * unparseable. Used by fetchWeatherSnapshot to bound the hourly
 * aggregation window.
 */
function parseHour(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (isNaN(h) || h < 0 || h > 23) return null;
  return h;
}

/**
 * Build a continuous weather snapshot for an event by reading the
 * cached daily values, plus (when start/end times are set) the
 * cached hourly values aggregated over the event's active window.
 *
 * Strategy:
 *   1. Look up weather_cache row for this event's lat/lng/date.
 *   2. If hourly_data is present AND event has both start and end
 *      times, aggregate hourly values within the [start, end) window.
 *      This captures evening conditions for an evening event vs the
 *      daily summary which would average a stormy afternoon with a
 *      clear evening.
 *   3. Otherwise, fall back to the daily max_temp_f /
 *      precipitation_in / prev_day_precip_in.
 *   4. If neither hourly nor daily is cached AND the event has
 *      lat/lng, attempt to fetch hourly via getHourlyWeatherForEvent
 *      (lazy populates the cache). Skip on failure.
 *   5. Return null if no usable data — engine falls back to the
 *      categorical bucket.
 *
 * Read-only on weather_cache when the row exists; writes happen via
 * getHourlyWeatherForEvent's lazy upsert.
 */
async function fetchWeatherSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: Event
): Promise<WeatherSnapshot | null> {
  if (event.latitude == null || event.longitude == null) return null;
  const lat = event.latitude;
  const lng = event.longitude;
  const date = event.event_date;

  // Try the cache first.
  const { data: cached } = await supabase
    .from("weather_cache")
    .select("max_temp_f, precipitation_in, prev_day_precip_in, hourly_data")
    .eq("date", date)
    .gte("latitude", lat - 0.1)
    .lte("latitude", lat + 0.1)
    .gte("longitude", lng - 0.1)
    .lte("longitude", lng + 0.1)
    .maybeSingle();

  const startHour = parseHour(event.start_time);
  const endHour = parseHour(event.end_time);

  // Hourly aggregation when we have both a window AND cached hourly data.
  if (
    cached?.hourly_data &&
    Array.isArray(cached.hourly_data) &&
    cached.hourly_data.length > 0 &&
    startHour != null &&
    endHour != null &&
    endHour > startHour
  ) {
    const window = aggregateHourlyForEventWindow(
      cached.hourly_data as HourlyWeatherEntry[],
      startHour,
      endHour,
      cached.prev_day_precip_in
    );
    if (window) return window;
  }

  // Fall back to daily summary if we have it cached.
  if (cached && (cached.max_temp_f != null || cached.precipitation_in != null)) {
    return {
      maxTempF: cached.max_temp_f,
      precipitationIn: cached.precipitation_in,
      prevDayPrecipIn: cached.prev_day_precip_in,
      source: "daily",
    };
  }

  // Last resort: fetch hourly fresh and aggregate (also lazily caches
  // for the next call). Only meaningful for events within the
  // forecast horizon (next 16 days) — older events without a cached
  // entry just get null and the engine falls back to the bucket.
  if (startHour != null && endHour != null && endHour > startHour) {
    try {
      const hourly = await getHourlyWeatherForEvent(lat, lng, date, supabase);
      if (hourly && hourly.length > 0) {
        return aggregateHourlyForEventWindow(
          hourly,
          startHour,
          endHour,
          cached?.prev_day_precip_in ?? null
        );
      }
    } catch {
      // Non-fatal; engine falls back to bucket.
    }
  }

  return null;
}
