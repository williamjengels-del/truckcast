import { createClient } from "@/lib/supabase/server";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import { updatePlatformRegistry, getPlatformEvents } from "@/lib/platform-registry";
import type { Event } from "@/lib/database.types";

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

  // Fetch platform event data for upcoming event names (for Level 0 blending)
  const today = new Date().toISOString().split("T")[0];
  const upcomingEvents = allEvents.filter((e) => e.event_date >= today && e.booked);
  const upcomingNames = [...new Set(upcomingEvents.map((e) => e.event_name))];
  const platformMap = await getPlatformEvents(upcomingNames).catch(() => new Map<string, import("@/lib/database.types").PlatformEvent>());

  // Recalculate forecasts for upcoming events
  for (const event of upcomingEvents) {
    const platformEvent = platformMap.get(event.event_name.toLowerCase().trim()) ?? null;
    const result = calculateForecast(event, allEvents, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    if (result) {
      await supabase
        .from("events")
        .update({ forecast_sales: result.forecast })
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
      await supabase
        .from("events")
        .update({ forecast_sales: result.forecast })
        .eq("id", event.id);
    }
  }
}
