/**
 * Service-role variant of recalculateForUser.
 * Accepts a pre-built Supabase client (service role) so it can be called
 * from the auto-sync cron route without per-request cookie auth.
 */

import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import type { Event } from "@/lib/database.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recalculateForUserWithClient(userId: string, supabase: any) {
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);

  const allEvents = (events ?? []) as Event[];

  const eventNames = [
    ...new Set(
      allEvents
        .filter((e) => e.booked && e.net_sales && e.net_sales > 0)
        .map((e) => e.event_name)
    ),
  ];

  for (const eventName of eventNames) {
    const perf = calculateEventPerformance(eventName, userId, allEvents);
    await supabase.from("event_performance").upsert(
      perf as Record<string, unknown>,
      { onConflict: "user_id,event_name" }
    );
  }

  const calibrated = calibrateCoefficients(allEvents);

  const today = new Date().toISOString().split("T")[0];
  const upcomingEvents = allEvents.filter(
    (e) => e.event_date >= today && e.booked
  );

  for (const event of upcomingEvents) {
    const result = calculateForecast(event, allEvents, { calibratedCoefficients: calibrated });
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

function forecastRange(forecast: number, confidenceScore: number): { low: number; high: number } {
  const pct = confidenceScore >= 0.7 ? 0.15 : confidenceScore >= 0.4 ? 0.25 : 0.40;
  return {
    low:  Math.round(forecast * (1 - pct) * 100) / 100,
    high: Math.round(forecast * (1 + pct) * 100) / 100,
  };
}
