import { createClient } from "@/lib/supabase/server";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import {
  updatePlatformRegistry,
  getPlatformEventsExcludingUser,
} from "@/lib/platform-registry";
import { autoClassifyWeather } from "@/lib/weather";
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
): Promise<{ forecastsUpdated: number; performanceUpdated: number; weatherClassified: number }> {
  const supabase = suppliedClient ?? (await createClient());

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
      const result = await autoClassifyWeather(cityStr, event.event_date, supabase);
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
  for (const event of futureEvents) {
    const platformEvent = event.booked
      ? (platformMap.get(event.event_name.toLowerCase().trim()) ?? null)
      : null;
    const result = calculateForecast(event, allEvents, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    if (result) {
      const { low, high } = forecastRange(result.forecast, result.confidenceScore);
      await supabase
        .from("events")
        .update({
          forecast_sales: result.forecast,
          forecast_low: low,
          forecast_high: high,
          forecast_confidence: result.confidence,
        })
        .eq("id", event.id);
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
      const { low, high } = forecastRange(result.forecast, result.confidenceScore);
      await supabase
        .from("events")
        .update({
          forecast_sales: result.forecast,
          forecast_low: low,
          forecast_high: high,
          forecast_confidence: result.confidence,
        })
        .eq("id", event.id);
      forecastsUpdated++;
    }
  }

  return {
    forecastsUpdated,
    performanceUpdated: eventNames.length,
    weatherClassified: weatherUpdates.size,
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
