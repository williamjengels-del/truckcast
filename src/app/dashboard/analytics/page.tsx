import type { Metadata } from "next";
export const metadata: Metadata = { title: "Analytics" };

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  CalendarCheck,
  TrendingUp,
  Star,
  Tag,
} from "lucide-react";
// TrendingUp used in KPI card
import { AnalyticsControls } from "./analytics-controls";
import { AnalyticsCharts } from "./analytics-charts";
import type { Event } from "@/lib/database.types";

function formatCurrency(val: number): string {
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
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

function filterEvents(
  events: Event[],
  year: number,
  month: number | null
): Event[] {
  return events.filter((e) => {
    const d = new Date(e.event_date + "T00:00:00");
    if (d.getFullYear() !== year) return false;
    if (month !== null && d.getMonth() !== month) return false;
    return true;
  });
}

function completedOnly(events: Event[]): Event[] {
  return events.filter(
    (e) => e.booked && e.net_sales !== null && e.net_sales > 0
  );
}

function computeMetrics(events: Event[]) {
  const completed = completedOnly(events);
  const totalRevenue = completed.reduce(
    (sum, e) => sum + (e.net_sales ?? 0),
    0
  );
  const eventCount = completed.length;
  const avgPerEvent = eventCount > 0 ? totalRevenue / eventCount : 0;

  // Best day of week
  const dowRevenue = new Map<number, number>();
  const dowCount = new Map<number, number>();
  for (const e of completed) {
    const dow = new Date(e.event_date + "T00:00:00").getDay();
    dowRevenue.set(dow, (dowRevenue.get(dow) ?? 0) + (e.net_sales ?? 0));
    dowCount.set(dow, (dowCount.get(dow) ?? 0) + 1);
  }
  let bestDow = "N/A";
  let bestDowRevenue = 0;
  for (const [dow, rev] of dowRevenue) {
    if (rev > bestDowRevenue) {
      bestDowRevenue = rev;
      bestDow = DAY_NAMES[dow];
    }
  }

  // Best event type
  const typeRevenue = new Map<string, number>();
  for (const e of completed) {
    const t = e.event_type ?? "Other";
    typeRevenue.set(t, (typeRevenue.get(t) ?? 0) + (e.net_sales ?? 0));
  }
  let bestType = "N/A";
  let bestTypeRevenue = 0;
  for (const [type, rev] of typeRevenue) {
    if (rev > bestTypeRevenue) {
      bestTypeRevenue = rev;
      bestType = type;
    }
  }

  return {
    totalRevenue,
    eventCount,
    avgPerEvent,
    bestDow,
    bestType,
    dowRevenue,
    dowCount,
    typeRevenue,
  };
}

function buildTrendData(
  events: Event[],
  year: number,
  month: number | null,
  compareEvents: Event[] | null,
  compareYear: number | null,
  compareMonth: number | null
) {
  const completed = completedOnly(events);
  const compareCompleted = compareEvents
    ? completedOnly(compareEvents)
    : null;

  if (month !== null) {
    // Daily view for a specific month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const data = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = d.toString();
      const dayRevenue = completed
        .filter((e) => {
          const dt = new Date(e.event_date + "T00:00:00");
          return dt.getDate() === d;
        })
        .reduce((sum, e) => sum + (e.net_sales ?? 0), 0);

      const point: { label: string; revenue: number; compareRevenue?: number } =
        { label: dayStr, revenue: Math.round(dayRevenue * 100) / 100 };

      if (compareCompleted && compareYear !== null && compareMonth !== null) {
        const compareDays = new Date(compareYear, compareMonth + 1, 0).getDate();
        if (d <= compareDays) {
          const cRev = compareCompleted
            .filter((e) => {
              const dt = new Date(e.event_date + "T00:00:00");
              return dt.getDate() === d;
            })
            .reduce((sum, e) => sum + (e.net_sales ?? 0), 0);
          point.compareRevenue = Math.round(cRev * 100) / 100;
        }
      }

      data.push(point);
    }
    return data;
  } else {
    // Monthly view for a full year
    const data = [];
    for (let m = 0; m < 12; m++) {
      const monthRevenue = completed
        .filter((e) => new Date(e.event_date + "T00:00:00").getMonth() === m)
        .reduce((sum, e) => sum + (e.net_sales ?? 0), 0);

      const point: { label: string; revenue: number; compareRevenue?: number } =
        {
          label: MONTH_SHORT[m],
          revenue: Math.round(monthRevenue * 100) / 100,
        };

      if (compareCompleted) {
        const cRev = compareCompleted
          .filter(
            (e) => new Date(e.event_date + "T00:00:00").getMonth() === m
          )
          .reduce((sum, e) => sum + (e.net_sales ?? 0), 0);
        point.compareRevenue = Math.round(cRev * 100) / 100;
      }

      data.push(point);
    }
    return data;
  }
}

function buildDowData(
  events: Event[],
  compareEvents: Event[] | null
) {
  const completed = completedOnly(events);
  const compareCompleted = compareEvents
    ? completedOnly(compareEvents)
    : null;

  return DAY_NAMES.map((day, i) => {
    const dayEvents = completed.filter(
      (e) => new Date(e.event_date + "T00:00:00").getDay() === i
    );
    const revenue = dayEvents.reduce(
      (sum, e) => sum + (e.net_sales ?? 0),
      0
    );

    const point: {
      day: string;
      revenue: number;
      count: number;
      compareRevenue?: number;
      compareCount?: number;
    } = {
      day,
      revenue: Math.round(revenue * 100) / 100,
      count: dayEvents.length,
    };

    if (compareCompleted) {
      const cDayEvents = compareCompleted.filter(
        (e) => new Date(e.event_date + "T00:00:00").getDay() === i
      );
      point.compareRevenue = Math.round(
        cDayEvents.reduce((sum, e) => sum + (e.net_sales ?? 0), 0) * 100
      ) / 100;
      point.compareCount = cDayEvents.length;
    }

    return point;
  });
}

function buildTypeData(
  events: Event[],
  compareEvents: Event[] | null
) {
  const completed = completedOnly(events);
  const compareCompleted = compareEvents
    ? completedOnly(compareEvents)
    : null;

  const allTypes = new Set<string>();
  for (const e of completed) allTypes.add(e.event_type ?? "Other");
  if (compareCompleted) {
    for (const e of compareCompleted) allTypes.add(e.event_type ?? "Other");
  }

  const data = Array.from(allTypes).map((type) => {
    const revenue = completed
      .filter((e) => (e.event_type ?? "Other") === type)
      .reduce((sum, e) => sum + (e.net_sales ?? 0), 0);

    const point: { name: string; revenue: number; compareRevenue?: number } = {
      name: type,
      revenue: Math.round(revenue * 100) / 100,
    };

    if (compareCompleted) {
      point.compareRevenue = Math.round(
        compareCompleted
          .filter((e) => (e.event_type ?? "Other") === type)
          .reduce((sum, e) => sum + (e.net_sales ?? 0), 0) * 100
      ) / 100;
    }

    return point;
  });

  data.sort((a, b) => b.revenue - a.revenue);
  return data;
}

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let events: Event[] = [];

  if (user) {
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .order("event_date", { ascending: false });
    events = (data ?? []) as Event[];
  }

  // Determine available years from data
  const yearSet = new Set<number>();
  for (const e of events) {
    yearSet.add(new Date(e.event_date + "T00:00:00").getFullYear());
  }
  const currentYear = new Date().getFullYear();
  yearSet.add(currentYear);
  const availableYears = Array.from(yearSet).sort((a, b) => b - a);

  // Parse search params
  const paramYear = typeof params.year === "string" ? parseInt(params.year, 10) : NaN;
  const selectedYear = isNaN(paramYear) ? currentYear : paramYear;

  const paramMonth = typeof params.month === "string" ? parseInt(params.month, 10) : NaN;
  const selectedMonth =
    !isNaN(paramMonth) && paramMonth >= 0 && paramMonth <= 11
      ? paramMonth
      : null;

  const compareEnabled = params.compare === "1";

  const paramCy = typeof params.cy === "string" ? parseInt(params.cy, 10) : NaN;
  const compareYear = compareEnabled
    ? isNaN(paramCy)
      ? selectedYear - 1
      : paramCy
    : null;

  const paramCm = typeof params.cm === "string" ? parseInt(params.cm, 10) : NaN;
  const compareMonth =
    compareEnabled && !isNaN(paramCm) && paramCm >= 0 && paramCm <= 11
      ? paramCm
      : compareEnabled && selectedMonth !== null
        ? selectedMonth
        : null;

  // Filter events for selected period
  const periodEvents = filterEvents(events, selectedYear, selectedMonth);
  const metrics = computeMetrics(periodEvents);

  // Filter events for comparison period
  const compareEvents =
    compareEnabled && compareYear !== null
      ? filterEvents(events, compareYear, compareMonth)
      : null;
  const compareMetrics =
    compareEvents !== null ? computeMetrics(compareEvents) : null;

  // Build chart data
  const trendData = buildTrendData(
    periodEvents,
    selectedYear,
    selectedMonth,
    compareEvents,
    compareYear,
    compareMonth
  );
  const dowData = buildDowData(periodEvents, compareEvents);
  const typeData = buildTypeData(periodEvents, compareEvents);

  // Period labels
  const MONTHS_FULL = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const periodLabel =
    selectedMonth !== null
      ? `${MONTHS_FULL[selectedMonth]} ${selectedYear}`
      : `${selectedYear}`;
  const comparePeriodLabel =
    compareEnabled && compareYear !== null
      ? compareMonth !== null
        ? `${MONTHS_FULL[compareMonth]} ${compareYear}`
        : `${compareYear}`
      : "";

  // Delta helper
  function delta(current: number, previous: number | undefined): string {
    if (previous === undefined || previous === 0) return "";
    const pct = ((current - previous) / previous) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
  }

  const kpis = [
    {
      label: "Total Revenue",
      value: formatCurrency(metrics.totalRevenue),
      delta: compareMetrics
        ? delta(metrics.totalRevenue, compareMetrics.totalRevenue)
        : undefined,
      icon: DollarSign,
      description: periodLabel,
    },
    {
      label: "Event Count",
      value: metrics.eventCount.toString(),
      delta: compareMetrics
        ? delta(metrics.eventCount, compareMetrics.eventCount)
        : undefined,
      icon: CalendarCheck,
      description: "Completed events with sales",
    },
    {
      label: "Avg Per Event",
      value: formatCurrency(metrics.avgPerEvent),
      delta: compareMetrics
        ? delta(metrics.avgPerEvent, compareMetrics.avgPerEvent)
        : undefined,
      icon: TrendingUp,
      description: "Average net sales per event",
    },
    {
      label: "Best Day of Week",
      value: metrics.bestDow,
      icon: Star,
      description: "Highest revenue day",
    },
    {
      label: "Best Event Type",
      value: metrics.bestType,
      icon: Tag,
      description: "Highest revenue category",
    },
  ];

  const hasData = events.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground">
          Historical performance breakdown and period comparisons
        </p>
      </div>

      <AnalyticsControls
        availableYears={availableYears}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        compareEnabled={compareEnabled}
        compareYear={compareYear}
        compareMonth={compareMonth}
      />

      {!hasData ? (
        <Card>
          <CardContent className="py-14 text-center space-y-4">
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <div>
              <p className="font-medium">No sales data yet</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs mx-auto">
                Analytics show revenue trends, top event types, and day-of-week performance — once you have events with sales logged.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <a href="/dashboard/events/import" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors">
                Import your events →
              </a>
              <a href="/dashboard/events?new=true" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
                Add manually
              </a>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {kpis.map((kpi) => (
              <Card key={kpi.label}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {kpi.label}
                  </CardTitle>
                  <kpi.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{kpi.value}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {kpi.description}
                    </p>
                    {kpi.delta && (
                      <span
                        className={`text-xs font-medium ${
                          kpi.delta.startsWith("+")
                            ? "text-green-600"
                            : kpi.delta.startsWith("-")
                              ? "text-red-600"
                              : "text-muted-foreground"
                        }`}
                      >
                        {kpi.delta}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <AnalyticsCharts
            trendData={trendData}
            dowData={dowData}
            typeData={typeData}
            compareEnabled={compareEnabled}
            periodLabel={periodLabel}
            comparePeriodLabel={comparePeriodLabel}
          />
        </>
      )}
    </div>
  );
}
