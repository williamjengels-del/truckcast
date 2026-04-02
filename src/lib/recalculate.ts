import { createClient } from "@/lib/supabase/server";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast } from "@/lib/forecast-engine";
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

  // Get unique event names with sales
  const eventNames = [
    ...new Set(
      allEvents
        .filter((e) => e.booked && e.net_sales && e.net_sales > 0)
        .map((e) => e.event_name)
    ),
  ];

  // Recalculate performance
  for (const eventName of eventNames) {
    const perf = calculateEventPerformance(eventName, userId, allEvents);
    await supabase.from("event_performance").upsert(
      perf as Record<string, unknown>,
      { onConflict: "user_id,event_name" }
    );
  }

  // Recalculate forecasts for upcoming events
  const today = new Date().toISOString().split("T")[0];
  const upcomingEvents = allEvents.filter(
    (e) => e.event_date >= today && e.booked
  );

  for (const event of upcomingEvents) {
    const result = calculateForecast(event, allEvents);
    if (result) {
      await supabase
        .from("events")
        .update({ forecast_sales: result.forecast })
        .eq("id", event.id);
    }
  }
}
