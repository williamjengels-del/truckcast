import type { Metadata } from "next";
export const metadata: Metadata = { title: "Reports" };

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Upload, Plus } from "lucide-react";
import type { Event, EventPerformance } from "@/lib/database.types";
import { type EventBreakdownRow } from "./event-breakdown-table";
import { ReportsInteractive } from "./reports-interactive";
import type {
  MonthlySummary,
  EventTypeBreakdown,
  DayOfWeekSummary,
  YoYData,
  Top10Row,
  LocationSummary,
  CompareEventRow,
} from "./reports-interactive";

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let events: Event[] = [];
  let performances: EventPerformance[] = [];

  if (user) {
    const [eventsRes, perfRes] = await Promise.all([
      supabase
        .from("events")
        .select("*")
        .eq("user_id", user.id)
        .order("event_date", { ascending: false }),
      supabase
        .from("event_performance")
        .select("*")
        .eq("user_id", user.id)
        .order("avg_sales", { ascending: false }),
    ]);
    events = (eventsRes.data ?? []) as Event[];
    performances = (perfRes.data ?? []) as EventPerformance[];
  }

  // Filter to only completed events with sales data
  const completedEvents = events.filter(
    (e) => e.net_sales !== null && e.net_sales > 0
  );

  // --- Monthly Summary ---
  const monthlyMap = new Map<
    string,
    { events: { name: string; revenue: number }[] }
  >();
  for (const e of completedEvents) {
    const key = getMonthKey(e.event_date);
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { events: [] });
    }
    monthlyMap.get(key)!.events.push({
      name: e.event_name,
      revenue: e.net_sales!,
    });
  }

  const monthlySummaries: MonthlySummary[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, data]) => {
      const sorted = [...data.events].sort((a, b) => b.revenue - a.revenue);
      const totalRevenue = data.events.reduce((s, ev) => s + ev.revenue, 0);
      return {
        month,
        monthLabel: getMonthLabel(month),
        eventCount: data.events.length,
        totalRevenue,
        avgRevenue: totalRevenue / data.events.length,
        bestEvent: sorted[0].name,
        bestRevenue: sorted[0].revenue,
        worstEvent: sorted[sorted.length - 1].name,
        worstRevenue: sorted[sorted.length - 1].revenue,
      };
    });

  // --- Event Type Breakdown ---
  const typeMap = new Map<string, { count: number; totalRevenue: number }>();
  for (const e of completedEvents) {
    const type = e.event_type ?? "Unknown";
    if (!typeMap.has(type)) {
      typeMap.set(type, { count: 0, totalRevenue: 0 });
    }
    const entry = typeMap.get(type)!;
    entry.count += 1;
    entry.totalRevenue += e.net_sales!;
  }

  const eventTypeBreakdown: EventTypeBreakdown[] = Array.from(
    typeMap.entries()
  )
    .map(([eventType, data]) => ({
      eventType,
      count: data.count,
      totalRevenue: data.totalRevenue,
      avgRevenue: data.totalRevenue / data.count,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // --- Day of Week Analysis ---
  const dayNames = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];
  const dayMap = new Map<number, { count: number; totalRevenue: number }>();
  for (const e of completedEvents) {
    const d = new Date(e.event_date + "T00:00:00");
    const dayIndex = d.getDay();
    if (!dayMap.has(dayIndex)) {
      dayMap.set(dayIndex, { count: 0, totalRevenue: 0 });
    }
    const entry = dayMap.get(dayIndex)!;
    entry.count += 1;
    entry.totalRevenue += e.net_sales!;
  }

  const dayOfWeekSummaries: DayOfWeekSummary[] = Array.from(dayMap.entries())
    .map(([dayIndex, data]) => ({
      day: dayNames[dayIndex],
      dayIndex,
      count: data.count,
      totalRevenue: data.totalRevenue,
      avgRevenue: data.totalRevenue / data.count,
    }))
    .sort((a, b) => b.avgRevenue - a.avgRevenue);

  // --- Year over Year ---
  const yearMap = new Map<number, { count: number; totalRevenue: number }>();
  for (const e of completedEvents) {
    const d = new Date(e.event_date + "T00:00:00");
    const year = d.getFullYear();
    if (!yearMap.has(year)) {
      yearMap.set(year, { count: 0, totalRevenue: 0 });
    }
    const entry = yearMap.get(year)!;
    entry.count += 1;
    entry.totalRevenue += e.net_sales!;
  }

  const yoyData: YoYData[] = Array.from(yearMap.entries())
    .map(([year, data]) => ({
      year,
      eventCount: data.count,
      totalRevenue: data.totalRevenue,
      avgRevenue: data.totalRevenue / data.count,
    }))
    .sort((a, b) => b.year - a.year);

  // --- Top 10 Events (from event_performance) ---
  const top10: Top10Row[] = performances.slice(0, 10).map((p) => ({
    id: p.id,
    event_name: p.event_name,
    times_booked: p.times_booked,
    avg_sales: p.avg_sales,
    total_sales: p.total_sales,
    trend: p.trend as string | null,
    confidence: p.confidence as string | null,
  }));

  // --- Event Performance Breakdown ---
  const eventBreakdownRows: EventBreakdownRow[] = completedEvents.map((e) => {
    const netSales = e.net_sales!;
    const feeAmount =
      e.net_sales !== null && e.net_after_fees !== null
        ? e.net_sales - e.net_after_fees
        : 0;
    let accuracy: number | null = null;
    if (e.forecast_sales !== null && e.forecast_sales > 0 && netSales > 0) {
      accuracy = Math.max(
        0,
        100 - (Math.abs(netSales - e.forecast_sales) / e.forecast_sales) * 100
      );
    }
    return {
      id: e.id,
      event_name: e.event_name,
      event_date: e.event_date,
      event_type: e.event_type,
      city: e.city,
      net_sales: netSales,
      forecast_sales: e.forecast_sales,
      accuracy,
      fee_type: e.fee_type,
      fee_amount: feeAmount,
      event_weather: e.event_weather,
    };
  });

  // --- Venue / Location Analysis ---
  const locationMap = new Map<
    string,
    { totalRevenue: number; eventCount: number }
  >();
  for (const e of completedEvents) {
    const city = e.city ?? "Unknown";
    if (!locationMap.has(city)) {
      locationMap.set(city, { totalRevenue: 0, eventCount: 0 });
    }
    const entry = locationMap.get(city)!;
    entry.totalRevenue += e.net_sales!;
    entry.eventCount += 1;
  }
  const locationSummaries: LocationSummary[] = Array.from(locationMap.entries())
    .map(([city, data]) => ({
      city,
      totalRevenue: data.totalRevenue,
      eventCount: data.eventCount,
      avgRevenue: data.totalRevenue / data.eventCount,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // --- Compare Events Data ---
  // Build per-event name aggregates for comparison tool
  const compareMap = new Map<
    string,
    {
      times_booked: number;
      total_sales: number;
      max_sales: number;
      min_sales: number;
      confidence: string | null;
      trend: string | null;
      consistency_score: number | null;
      forecast_next: number | null;
      occurrences: { net_sales: number; anomaly_flag: string | null }[];
    }
  >();

  // First use event_performance data as authoritative source
  for (const p of performances) {
    compareMap.set(p.event_name, {
      times_booked: p.times_booked,
      total_sales: p.total_sales,
      max_sales: p.max_sales,
      min_sales: p.min_sales,
      confidence: p.confidence as string | null,
      trend: p.trend as string | null,
      consistency_score: p.consistency_score,
      forecast_next: p.forecast_next,
      occurrences: [],
    });
  }

  // Populate occurrences from completed events
  for (const e of completedEvents) {
    if (compareMap.has(e.event_name)) {
      compareMap.get(e.event_name)!.occurrences.push({
        net_sales: e.net_sales!,
        anomaly_flag: e.anomaly_flag ?? null,
      });
    }
  }

  const compareEventRows: CompareEventRow[] = Array.from(compareMap.entries())
    .map(([event_name, data]) => ({
      event_name,
      times_booked: data.times_booked,
      avg_sales: data.times_booked > 0 ? data.total_sales / data.times_booked : 0,
      max_sales: data.max_sales,
      min_sales: data.min_sales,
      total_sales: data.total_sales,
      confidence: data.confidence,
      trend: data.trend,
      consistency_score: data.consistency_score,
      forecast_next: data.forecast_next,
      occurrences: data.occurrences.sort((a, b) => a.net_sales - b.net_sales),
    }))
    .sort((a, b) => b.avg_sales - a.avg_sales);

  // --- Summary Stats ---
  const totalRevenue = completedEvents.reduce(
    (s, e) => s + (e.net_sales ?? 0),
    0
  );
  const eventsCompleted = completedEvents.length;
  const avgPerEvent = eventsCompleted > 0 ? totalRevenue / eventsCompleted : 0;

  // Best single event (one occurrence)
  let bestEventName = "";
  let bestEventRevenue = 0;
  for (const e of completedEvents) {
    if (e.net_sales! > bestEventRevenue) {
      bestEventRevenue = e.net_sales!;
      bestEventName = e.event_name;
    }
  }

  // Forecast accuracy
  const eventsWithBoth = completedEvents.filter(
    (e) => e.forecast_sales !== null && e.forecast_sales > 0
  );
  let forecastAccuracy: string | null = null;
  if (eventsWithBoth.length >= 3) {
    const mape =
      eventsWithBoth.reduce((sum, e) => {
        const actual = e.net_sales ?? 0;
        const forecast = e.forecast_sales ?? 0;
        return sum + Math.abs(actual - forecast) / Math.max(actual, 1);
      }, 0) / eventsWithBoth.length;
    forecastAccuracy = `${Math.round((1 - mape) * 100)}%`;
  }

  const overallAvg = avgPerEvent;

  if (completedEvents.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Performance reports and insights from your event history</p>
        </div>
        <Card>
          <CardContent className="py-14 text-center space-y-4">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <div>
              <p className="font-medium">No sales data yet</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
                Reports show monthly summaries, top events, revenue by type, and year-over-year comparisons — once you have events with sales logged.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Link href="/dashboard/events/import">
                <Button size="sm" className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Import events
                </Button>
              </Link>
              <Link href="/dashboard/events?new=true">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add manually
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Performance reports and insights from your event history
        </p>
      </div>

      <ReportsInteractive
        monthlySummaries={monthlySummaries}
        eventTypeBreakdown={eventTypeBreakdown}
        dayOfWeekSummaries={dayOfWeekSummaries}
        yoyData={yoyData}
        top10={top10}
        eventBreakdownRows={eventBreakdownRows}
        locationSummaries={locationSummaries}
        compareEventRows={compareEventRows}
        totalRevenue={totalRevenue}
        eventsCompleted={eventsCompleted}
        avgPerEvent={avgPerEvent}
        bestEventName={bestEventName}
        bestEventRevenue={bestEventRevenue}
        forecastAccuracy={forecastAccuracy}
        overallAvg={overallAvg}
      />
    </div>
  );
}
