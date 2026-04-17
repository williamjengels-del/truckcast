import { createClient } from "@/lib/supabase/server";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import { updatePlatformRegistry, getPlatformEvents } from "@/lib/platform-registry";
import { autoClassifyWeather } from "@/lib/weather";
import type { Event, WeatherType } from "@/lib/database.types";

/**
 * Server-side recalculation of event performance and forecasts.
 * Called after any event mutation (create, update, delete).
 */
export async function recalculateForUser(userId: string) {
  const supabase = await createClient();

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

  // Update platform registry with cross-user aggregates — fire and forget (non-blocking)
  updatePlatformRegistry(eventNames).catch(() => {});

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
  const platformMap = await getPlatformEvents(upcomingNames).catch(() => new Map<string, import("@/lib/database.types").PlatformEvent>());

  // Recalculate forecasts for ALL future events — booked AND unbooked
  const futureEvents = allEvents.filter((e) => e.event_date >= today);
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
    }
  }

  // Backfill forecast_sales for past events that have sales but no forecast.
  // This covers events that were added/booked after their date passed, or events
  // where the forecast engine ran before enough historical data existed.
  const pastEventsNeedingForecast = allEvents.filter(
    (e) =>
      e.event_date < today &&
      e.booked &&
      ((e.net_sales !== null && e.net_sales > 0) ||
        (e.event_mode === "catering" && e.invoice_revenue > 0)) &&
      e.forecast_sales === null &&
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
    }
  }
}

/**
 * Derive a forecast range (low / high) from the point forecast and confidence score.
 * Thresholds mirror confidenceScoreToLabel in forecast-engine.ts so the pill
 * and the range width stay aligned — a HIGH-pill forecast always gets ±15%.
 *   HIGH   (score ≥ 0.65): ±15%
 *   MEDIUM (score ≥ 0.40): ±25%
 *   LOW    (score < 0.40): ±40%
 */
function forecastRange(forecast: number, confidenceScore: number): { low: number; high: number } {
  const pct = confidenceScore >= 0.65 ? 0.15 : confidenceScore >= 0.4 ? 0.25 : 0.40;
  return {
    low:  Math.round(forecast * (1 - pct) * 100) / 100,
    high: Math.round(forecast * (1 + pct) * 100) / 100,
  };
}
