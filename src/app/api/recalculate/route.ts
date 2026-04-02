import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import type { Event } from "@/lib/database.types";

/**
 * POST /api/recalculate
 * Recalculates event performance and forecasts for the authenticated user.
 * Called after sales entry, event creation, or event deletion.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch all events for this user
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id);

    if (eventsError) {
      return NextResponse.json(
        { error: eventsError.message },
        { status: 500 }
      );
    }

    const allEvents = (events ?? []) as Event[];

    // Get unique event names (for events with sales data)
    const eventNames = [
      ...new Set(
        allEvents
          .filter((e) => e.booked && e.net_sales && e.net_sales > 0)
          .map((e) => e.event_name)
      ),
    ];

    // Recalculate performance for each unique event name
    for (const eventName of eventNames) {
      const perf = calculateEventPerformance(eventName, user.id, allEvents);

      await supabase.from("event_performance").upsert(
        perf as Record<string, unknown>,
        { onConflict: "user_id,event_name" }
      );
    }

    // Calibrate per-user coefficients from historical data
    const calibrated = calibrateCoefficients(allEvents);

    // Recalculate forecasts for upcoming events
    const today = new Date().toISOString().split("T")[0];
    const upcomingEvents = allEvents.filter(
      (e) => e.event_date >= today && e.booked
    );

    for (const event of upcomingEvents) {
      const forecastResult = calculateForecast(event, allEvents, { calibratedCoefficients: calibrated });
      if (forecastResult) {
        await supabase
          .from("events")
          .update({ forecast_sales: forecastResult.forecast })
          .eq("id", event.id);
      }
    }

    return NextResponse.json({
      success: true,
      performanceUpdated: eventNames.length,
      forecastsUpdated: upcomingEvents.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
