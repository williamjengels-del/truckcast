import type { Metadata } from "next";
export const metadata: Metadata = { title: "Forecast Calculator" };

import { createClient } from "@/lib/supabase/server";
import { calibrateCoefficients } from "@/lib/forecast-engine";
import { ForecastCalculator } from "@/components/forecast-calculator";
import type { Event } from "@/lib/database.types";

export default async function CalculatorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let events: Event[] = [];
  let overallAvg: number | null = null;
  const eventTypeAvgs: Record<string, number> = {};

  if (user) {
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .eq("booked", true)
      .not("net_sales", "is", null)
      .gt("net_sales", 0)
      .order("event_date", { ascending: false });

    events = (data ?? []) as Event[];

    // Pre-compute per-type averages for comparison callout
    if (events.length > 0) {
      const sum = events.reduce((s, e) => s + (e.net_sales ?? 0), 0);
      overallAvg = sum / events.length;

      const typeMap: Record<string, { sum: number; count: number }> = {};
      for (const e of events) {
        const t = e.event_type ?? "Other";
        if (!typeMap[t]) typeMap[t] = { sum: 0, count: 0 };
        typeMap[t].sum += e.net_sales ?? 0;
        typeMap[t].count += 1;
      }
      for (const [type, { sum, count }] of Object.entries(typeMap)) {
        if (count >= 2) eventTypeAvgs[type] = sum / count;
      }
    }
  }

  const coefficients = calibrateCoefficients(events);

  return (
    <ForecastCalculator
      historicalEvents={events}
      overallAvg={overallAvg}
      eventTypeAvgs={eventTypeAvgs}
      calibratedCoefficients={coefficients}
      isPublic={false}
    />
  );
}
