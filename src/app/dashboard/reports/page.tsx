import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Event, EventPerformance } from "@/lib/database.types";
import {
  EventBreakdownTable,
  type EventBreakdownRow,
} from "./event-breakdown-table";
import {
  SeasonalTrendsCharts,
  FeeImpactChart,
  type MonthlyTrendData,
  type QuarterData,
  type WeekendVsWeekdayData,
  type FeeImpactData,
} from "./reports-charts";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
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

function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-32 flex items-center justify-center text-muted-foreground">
      {message}
    </div>
  );
}

interface MonthlySummary {
  month: string;
  eventCount: number;
  totalRevenue: number;
  avgRevenue: number;
  bestEvent: string;
  bestRevenue: number;
  worstEvent: string;
  worstRevenue: number;
}

interface EventTypeBreakdown {
  eventType: string;
  count: number;
  totalRevenue: number;
  avgRevenue: number;
}

interface DayOfWeekSummary {
  day: string;
  dayIndex: number;
  count: number;
  totalRevenue: number;
  avgRevenue: number;
}

interface YoYData {
  year: number;
  eventCount: number;
  totalRevenue: number;
  avgRevenue: number;
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
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
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
  const yearMap = new Map<
    number,
    { count: number; totalRevenue: number }
  >();
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

  const hasMultipleYears = yoyData.length > 1;

  // --- Top 10 Events (from event_performance) ---
  const top10 = performances.slice(0, 10);

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
  interface LocationSummary {
    city: string;
    totalRevenue: number;
    eventCount: number;
    avgRevenue: number;
  }
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
  const locationSummaries: LocationSummary[] = Array.from(
    locationMap.entries()
  )
    .map(([city, data]) => ({
      city,
      totalRevenue: data.totalRevenue,
      eventCount: data.eventCount,
      avgRevenue: data.totalRevenue / data.eventCount,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  const bestLocation =
    locationSummaries.length > 0 ? locationSummaries[0] : null;
  const worstLocation =
    locationSummaries.length > 1
      ? locationSummaries[locationSummaries.length - 1]
      : null;

  // --- Seasonal Trends ---
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthAggMap = new Map<
    number,
    { totalRevenue: number; eventCount: number }
  >();
  for (const e of completedEvents) {
    const d = new Date(e.event_date + "T00:00:00");
    const m = d.getMonth();
    if (!monthAggMap.has(m)) {
      monthAggMap.set(m, { totalRevenue: 0, eventCount: 0 });
    }
    const entry = monthAggMap.get(m)!;
    entry.totalRevenue += e.net_sales!;
    entry.eventCount += 1;
  }
  const monthlyTrend: MonthlyTrendData[] = Array.from(monthAggMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([m, data]) => ({
      month: String(m),
      monthLabel: monthNames[m],
      revenue: data.totalRevenue,
      events: data.eventCount,
      avgRevenue: Math.round(data.totalRevenue / data.eventCount),
    }));

  // Quarter data
  const quarterAggMap = new Map<
    string,
    { totalRevenue: number; eventCount: number }
  >();
  for (const e of completedEvents) {
    const d = new Date(e.event_date + "T00:00:00");
    const q = `Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (!quarterAggMap.has(q)) {
      quarterAggMap.set(q, { totalRevenue: 0, eventCount: 0 });
    }
    const entry = quarterAggMap.get(q)!;
    entry.totalRevenue += e.net_sales!;
    entry.eventCount += 1;
  }
  const quarterData: QuarterData[] = ["Q1", "Q2", "Q3", "Q4"]
    .filter((q) => quarterAggMap.has(q))
    .map((q) => {
      const data = quarterAggMap.get(q)!;
      return {
        quarter: q,
        revenue: data.totalRevenue,
        events: data.eventCount,
        avgRevenue: Math.round(data.totalRevenue / data.eventCount),
      };
    });

  // Weekend vs weekday
  let weekendStats = { totalRevenue: 0, eventCount: 0 };
  let weekdayStats = { totalRevenue: 0, eventCount: 0 };
  for (const e of completedEvents) {
    const d = new Date(e.event_date + "T00:00:00");
    const day = d.getDay();
    if (day === 0 || day === 5 || day === 6) {
      weekendStats.totalRevenue += e.net_sales!;
      weekendStats.eventCount += 1;
    } else {
      weekdayStats.totalRevenue += e.net_sales!;
      weekdayStats.eventCount += 1;
    }
  }
  const weekendVsWeekday: WeekendVsWeekdayData[] = [
    {
      label: "Weekend (Fri-Sun)",
      revenue: weekendStats.totalRevenue,
      events: weekendStats.eventCount,
      avgRevenue:
        weekendStats.eventCount > 0
          ? Math.round(weekendStats.totalRevenue / weekendStats.eventCount)
          : 0,
    },
    {
      label: "Weekday (Mon-Thu)",
      revenue: weekdayStats.totalRevenue,
      events: weekdayStats.eventCount,
      avgRevenue:
        weekdayStats.eventCount > 0
          ? Math.round(weekdayStats.totalRevenue / weekdayStats.eventCount)
          : 0,
    },
  ];

  // --- Fee Impact Analysis ---
  const feeAggMap = new Map<
    string,
    { totalRevenue: number; totalNetSales: number; totalFees: number; eventCount: number }
  >();
  for (const e of completedEvents) {
    const ft = e.fee_type;
    if (!feeAggMap.has(ft)) {
      feeAggMap.set(ft, {
        totalRevenue: 0,
        totalNetSales: 0,
        totalFees: 0,
        eventCount: 0,
      });
    }
    const entry = feeAggMap.get(ft)!;
    entry.totalRevenue += e.net_sales!;
    entry.totalNetSales += e.net_after_fees ?? e.net_sales!;
    entry.totalFees +=
      e.net_sales !== null && e.net_after_fees !== null
        ? e.net_sales - e.net_after_fees
        : 0;
    entry.eventCount += 1;
  }

  const feeTypeLabels: Record<string, string> = {
    none: "No Fee",
    flat_fee: "Flat Fee",
    percentage: "Percentage",
    commission_with_minimum: "Commission + Min",
    pre_settled: "Pre-Settled",
  };

  const feeImpact: FeeImpactData[] = Array.from(feeAggMap.entries())
    .map(([feeType, data]) => ({
      feeType,
      label: feeTypeLabels[feeType] ?? feeType,
      totalRevenue: data.totalRevenue,
      avgNetSales: Math.round(data.totalNetSales / data.eventCount),
      totalFees: Math.round(data.totalFees),
      events: data.eventCount,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Performance reports and insights from your event history
        </p>
      </div>

      {/* Monthly Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlySummaries.length === 0 ? (
            <EmptyState message="Not enough data yet. Complete some events with sales to see monthly summaries." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Avg / Event</TableHead>
                  <TableHead>Best Event</TableHead>
                  <TableHead>Worst Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlySummaries.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell className="font-medium">
                      {getMonthLabel(row.month)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.eventCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.avgRevenue)}
                    </TableCell>
                    <TableCell>
                      {row.bestEvent}{" "}
                      <span className="text-muted-foreground text-xs">
                        ({formatCurrency(row.bestRevenue)})
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.worstEvent}{" "}
                      <span className="text-muted-foreground text-xs">
                        ({formatCurrency(row.worstRevenue)})
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Event Type Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Event Type Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {eventTypeBreakdown.length === 0 ? (
            <EmptyState message="Not enough data yet. Log events with sales and event types to see this breakdown." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event Type</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Avg Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventTypeBreakdown.map((row) => (
                  <TableRow key={row.eventType}>
                    <TableCell>
                      <Badge variant="secondary">{row.eventType}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.avgRevenue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Day of Week Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Day of Week Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {dayOfWeekSummaries.length === 0 ? (
            <EmptyState message="Not enough data yet. Complete events with sales to see which days perform best." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Avg Revenue</TableHead>
                  <TableHead>Performance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayOfWeekSummaries.map((row, idx) => (
                  <TableRow key={row.day}>
                    <TableCell className="font-medium">{row.day}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.avgRevenue)}
                    </TableCell>
                    <TableCell>
                      {idx === 0 ? (
                        <Badge className="bg-green-600 hover:bg-green-700">
                          Best
                        </Badge>
                      ) : idx === dayOfWeekSummaries.length - 1 &&
                        dayOfWeekSummaries.length > 1 ? (
                        <Badge variant="destructive">Lowest</Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Year over Year */}
      <Card>
        <CardHeader>
          <CardTitle>Year over Year</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasMultipleYears ? (
            <EmptyState message="Not enough data yet. Year-over-year comparison requires events from multiple years." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Avg / Event</TableHead>
                  <TableHead className="text-right">YoY Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yoyData.map((row, idx) => {
                  const prevYear = yoyData[idx + 1];
                  let yoyChange: number | null = null;
                  if (prevYear) {
                    yoyChange =
                      ((row.totalRevenue - prevYear.totalRevenue) /
                        prevYear.totalRevenue) *
                      100;
                  }
                  return (
                    <TableRow key={row.year}>
                      <TableCell className="font-medium">{row.year}</TableCell>
                      <TableCell className="text-right">
                        {row.eventCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.totalRevenue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.avgRevenue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {yoyChange !== null ? (
                          <span
                            className={
                              yoyChange >= 0
                                ? "text-green-600"
                                : "text-red-600"
                            }
                          >
                            {yoyChange >= 0 ? "+" : ""}
                            {yoyChange.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top 10 Events */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Events</CardTitle>
        </CardHeader>
        <CardContent>
          {top10.length === 0 ? (
            <EmptyState message="Not enough data yet. Event performance data will appear after you complete events." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Event Name</TableHead>
                  <TableHead className="text-right">Times Booked</TableHead>
                  <TableHead className="text-right">Avg Revenue</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top10.map((perf, idx) => (
                  <TableRow key={perf.id}>
                    <TableCell className="text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {perf.event_name}
                    </TableCell>
                    <TableCell className="text-right">
                      {perf.times_booked}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(perf.avg_sales)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(perf.total_sales)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          perf.trend === "Growing"
                            ? "default"
                            : perf.trend === "Declining"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {perf.trend}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          perf.confidence === "HIGH"
                            ? "default"
                            : perf.confidence === "LOW"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {perf.confidence}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Event Performance Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Event Performance Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <EventBreakdownTable rows={eventBreakdownRows} />
        </CardContent>
      </Card>

      {/* Venue / Location Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Venue / Location Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {locationSummaries.length === 0 ? (
            <EmptyState message="Not enough data yet. Complete events with city information to see location analysis." />
          ) : (
            <div className="space-y-4">
              {(bestLocation || worstLocation) && (
                <div className="flex flex-wrap gap-3">
                  {bestLocation && (
                    <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3 flex-1 min-w-[200px]">
                      <p className="text-xs text-muted-foreground">
                        Best Performing Location
                      </p>
                      <p className="text-lg font-semibold">
                        {bestLocation.city}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(bestLocation.totalRevenue)} total
                        &middot; {formatCurrency(bestLocation.avgRevenue)} avg
                        &middot; {bestLocation.eventCount} event
                        {bestLocation.eventCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  )}
                  {worstLocation && (
                    <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 flex-1 min-w-[200px]">
                      <p className="text-xs text-muted-foreground">
                        Lowest Performing Location
                      </p>
                      <p className="text-lg font-semibold">
                        {worstLocation.city}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(worstLocation.totalRevenue)} total
                        &middot; {formatCurrency(worstLocation.avgRevenue)} avg
                        &middot; {worstLocation.eventCount} event
                        {worstLocation.eventCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>City</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">Total Revenue</TableHead>
                    <TableHead className="text-right">Avg / Event</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locationSummaries.map((loc) => (
                    <TableRow key={loc.city}>
                      <TableCell className="font-medium">{loc.city}</TableCell>
                      <TableCell className="text-right">
                        {loc.eventCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(loc.totalRevenue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(loc.avgRevenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seasonal Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Seasonal Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <SeasonalTrendsCharts
            monthlyTrend={monthlyTrend}
            quarterData={quarterData}
            weekendVsWeekday={weekendVsWeekday}
          />
        </CardContent>
      </Card>

      {/* Fee Impact Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Fee Impact Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <FeeImpactChart feeImpact={feeImpact} />
        </CardContent>
      </Card>
    </div>
  );
}
