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
    </div>
  );
}
