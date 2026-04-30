import type { Event, EventPerformance } from "./database.types";

// Type definitions — used by both the Reports tab and any consumer
// (Dashboard, marketing copy generation) that needs aggregate shapes.

export interface MonthlySummary {
  month: string;
  monthLabel: string;
  eventCount: number;
  totalRevenue: number;
  avgRevenue: number;
  bestEvent: string;
  bestRevenue: number;
  worstEvent: string;
  worstRevenue: number;
}

export interface EventTypeBreakdown {
  eventType: string;
  count: number;
  totalRevenue: number;
  avgRevenue: number;
}

export interface DayOfWeekSummary {
  day: string;
  dayIndex: number;
  count: number;
  totalRevenue: number;
  avgRevenue: number;
}

export interface YoYData {
  year: number;
  eventCount: number;
  totalRevenue: number;
  avgRevenue: number;
}

export interface Top10Row {
  id: string;
  event_name: string;
  times_booked: number;
  avg_sales: number;
  total_sales: number;
  trend: string | null;
  confidence: string | null;
}

export interface LocationSummary {
  city: string;
  totalRevenue: number;
  eventCount: number;
  avgRevenue: number;
}

export interface CompareEventRow {
  event_name: string;
  times_booked: number;
  avg_sales: number;
  max_sales: number;
  min_sales: number;
  total_sales: number;
  confidence: string | null;
  trend: string | null;
  consistency_score: number | null;
  forecast_next: number | null;
  occurrences: { net_sales: number; anomaly_flag: string | null }[];
}

export interface EventBreakdownRow {
  id: string;
  event_name: string;
  event_date: string;
  event_type: string | null;
  city: string | null;
  net_sales: number;
  forecast_sales: number | null;
  accuracy: number | null;
  fee_type: string | null;
  fee_amount: number;
  event_weather: string | null;
}

export interface ReportsAggregates {
  monthlySummaries: MonthlySummary[];
  eventTypeBreakdown: EventTypeBreakdown[];
  dayOfWeekSummaries: DayOfWeekSummary[];
  yoyData: YoYData[];
  top10: Top10Row[];
  eventBreakdownRows: EventBreakdownRow[];
  locationSummaries: LocationSummary[];
  compareEventRows: CompareEventRow[];
  totalRevenue: number;
  eventsCompleted: number;
  avgPerEvent: number;
  bestEventName: string;
  bestEventRevenue: number;
  forecastAccuracy: string | null;
  overallAvg: number;
}

function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/**
 * Compute all reports-page aggregates from raw events + performance rows.
 * Single source of truth — consumed by /dashboard/insights?tab=reports,
 * by the Dashboard's Key Takeaways card, and by any downstream summary
 * view that needs the same numbers.
 */
export function computeReportsAggregates(
  events: Event[],
  performances: EventPerformance[]
): ReportsAggregates {
  // caused_by_event_id check excludes carry-over linkages (e.g., Sunday
  // cancelled because Saturday sold out) from every aggregate this function
  // produces — monthly totals, day-of-week, top-10, accuracy. Saturday's
  // overrun is the credited outcome; the cancelled Sunday is bookkeeping
  // and shouldn't influence aggregates.
  const completedEvents = events.filter(
    (e) =>
      e.booked !== false &&
      !e.caused_by_event_id &&
      ((e.net_sales !== null && e.net_sales > 0) ||
        (e.event_mode === "catering" && e.invoice_revenue > 0))
  );

  // Monthly
  const monthlyMap = new Map<string, { events: { name: string; revenue: number }[] }>();
  for (const e of completedEvents) {
    const key = getMonthKey(e.event_date);
    if (!monthlyMap.has(key)) monthlyMap.set(key, { events: [] });
    monthlyMap.get(key)!.events.push({ name: e.event_name, revenue: eventRevenue(e) });
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

  // Event Type Breakdown
  const typeMap = new Map<string, { count: number; totalRevenue: number }>();
  for (const e of completedEvents) {
    const type = e.event_type ?? "Unknown";
    if (!typeMap.has(type)) typeMap.set(type, { count: 0, totalRevenue: 0 });
    const entry = typeMap.get(type)!;
    entry.count += 1;
    entry.totalRevenue += eventRevenue(e);
  }
  const eventTypeBreakdown: EventTypeBreakdown[] = Array.from(typeMap.entries())
    .map(([eventType, data]) => ({
      eventType,
      count: data.count,
      totalRevenue: data.totalRevenue,
      avgRevenue: data.totalRevenue / data.count,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Day of Week
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayMap = new Map<number, { count: number; totalRevenue: number }>();
  for (const e of completedEvents) {
    const dayIndex = new Date(e.event_date + "T00:00:00").getDay();
    if (!dayMap.has(dayIndex)) dayMap.set(dayIndex, { count: 0, totalRevenue: 0 });
    const entry = dayMap.get(dayIndex)!;
    entry.count += 1;
    entry.totalRevenue += eventRevenue(e);
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

  // YoY (YTD-normalized)
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();
  const yearMap = new Map<number, { count: number; totalRevenue: number }>();
  for (const e of completedEvents) {
    const d = new Date(e.event_date + "T00:00:00");
    const year = d.getFullYear();
    const eventMonth = d.getMonth();
    const eventDay = d.getDate();
    const withinYTD =
      eventMonth < currentMonth ||
      (eventMonth === currentMonth && eventDay <= currentDay);
    if (!withinYTD) continue;
    if (!yearMap.has(year)) yearMap.set(year, { count: 0, totalRevenue: 0 });
    const entry = yearMap.get(year)!;
    entry.count += 1;
    entry.totalRevenue += eventRevenue(e);
  }
  const yoyData: YoYData[] = Array.from(yearMap.entries())
    .map(([year, data]) => ({
      year,
      eventCount: data.count,
      totalRevenue: data.totalRevenue,
      avgRevenue: data.totalRevenue / data.count,
    }))
    .sort((a, b) => b.year - a.year);

  // Top 10 from event_performance
  const top10: Top10Row[] = performances.slice(0, 10).map((p) => ({
    id: p.id,
    event_name: p.event_name,
    times_booked: p.times_booked,
    avg_sales: p.avg_sales,
    total_sales: p.total_sales,
    trend: p.trend as string | null,
    confidence: p.confidence as string | null,
  }));

  // Event breakdown
  const eventBreakdownRows: EventBreakdownRow[] = completedEvents.map((e) => {
    const rev = eventRevenue(e);
    const feeAmount =
      e.net_sales !== null && e.net_after_fees !== null
        ? e.net_sales - e.net_after_fees
        : 0;
    let accuracy: number | null = null;
    if (e.forecast_sales !== null && e.forecast_sales > 0 && rev > 0) {
      accuracy = Math.max(
        0,
        100 - (Math.abs(rev - e.forecast_sales) / e.forecast_sales) * 100
      );
    }
    return {
      id: e.id,
      event_name: e.event_name,
      event_date: e.event_date,
      event_type: e.event_type,
      city: e.city,
      net_sales: rev,
      forecast_sales: e.forecast_sales,
      accuracy,
      fee_type: e.fee_type,
      fee_amount: feeAmount,
      event_weather: e.event_weather,
    };
  });

  // Locations
  const locationMap = new Map<string, { totalRevenue: number; eventCount: number }>();
  for (const e of completedEvents) {
    const city = e.city ?? "Unknown";
    if (!locationMap.has(city)) locationMap.set(city, { totalRevenue: 0, eventCount: 0 });
    const entry = locationMap.get(city)!;
    entry.totalRevenue += eventRevenue(e);
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

  // Compare events
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
  for (const e of completedEvents) {
    if (compareMap.has(e.event_name)) {
      compareMap.get(e.event_name)!.occurrences.push({
        net_sales: eventRevenue(e),
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

  // Summary stats
  const totalRevenue = completedEvents.reduce((s, e) => s + eventRevenue(e), 0);
  const eventsCompleted = completedEvents.length;
  const avgPerEvent = eventsCompleted > 0 ? totalRevenue / eventsCompleted : 0;

  let bestEventName = "";
  let bestEventRevenue = 0;
  for (const e of completedEvents) {
    const rev = eventRevenue(e);
    if (rev > bestEventRevenue) {
      bestEventRevenue = rev;
      bestEventName = e.event_name;
    }
  }

  const eventsWithBoth = completedEvents.filter(
    (e) => e.forecast_sales !== null && e.forecast_sales > 0 && eventRevenue(e) > 0
  );
  let forecastAccuracy: string | null = null;
  if (eventsWithBoth.length >= 3) {
    const totalActual = eventsWithBoth.reduce((sum, e) => sum + eventRevenue(e), 0);
    const weightedError = eventsWithBoth.reduce((sum, e) => {
      const actual = eventRevenue(e);
      const forecast = e.forecast_sales ?? 0;
      const weight = actual / totalActual;
      return sum + weight * (Math.abs(actual - forecast) / actual);
    }, 0);
    forecastAccuracy = `${Math.round((1 - weightedError) * 100)}%`;
  }

  return {
    monthlySummaries,
    eventTypeBreakdown,
    dayOfWeekSummaries,
    yoyData,
    top10,
    eventBreakdownRows,
    locationSummaries,
    compareEventRows,
    totalRevenue,
    eventsCompleted,
    avgPerEvent,
    bestEventName,
    bestEventRevenue,
    forecastAccuracy,
    overallAvg: avgPerEvent,
  };
}
