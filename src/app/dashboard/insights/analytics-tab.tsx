import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  CalendarCheck,
  TrendingUp,
  Star,
  Tag,
  PiggyBank,
  ChevronUp,
  ChevronDown,
  Minus,
  MapPin,
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
    (e) =>
      e.booked &&
      ((e.net_sales !== null && e.net_sales > 0) ||
        (e.event_mode === "catering" && e.invoice_revenue > 0))
  );
}

/** Total recognised revenue for an event: on-site sales + catering invoice */
function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
}

function computeMetrics(events: Event[]) {
  const completed = completedOnly(events);
  const totalRevenue = completed.reduce(
    (sum, e) => sum + eventRevenue(e),
    0
  );
  const eventCount = completed.length;
  const avgPerEvent = eventCount > 0 ? totalRevenue / eventCount : 0;

  // Best day of week
  const dowRevenue = new Map<number, number>();
  const dowCount = new Map<number, number>();
  for (const e of completed) {
    const dow = new Date(e.event_date + "T00:00:00").getDay();
    dowRevenue.set(dow, (dowRevenue.get(dow) ?? 0) + eventRevenue(e));
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
    typeRevenue.set(t, (typeRevenue.get(t) ?? 0) + eventRevenue(e));
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
        .reduce((sum, e) => sum + eventRevenue(e), 0);

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
            .reduce((sum, e) => sum + eventRevenue(e), 0);
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
        .reduce((sum, e) => sum + eventRevenue(e), 0);

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
          .reduce((sum, e) => sum + eventRevenue(e), 0);
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
      (sum, e) => sum + eventRevenue(e),
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
        cDayEvents.reduce((sum, e) => sum + eventRevenue(e), 0) * 100
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
      .reduce((sum, e) => sum + eventRevenue(e), 0);

    const point: { name: string; revenue: number; compareRevenue?: number } = {
      name: type,
      revenue: Math.round(revenue * 100) / 100,
    };

    if (compareCompleted) {
      point.compareRevenue = Math.round(
        compareCompleted
          .filter((e) => (e.event_type ?? "Other") === type)
          .reduce((sum, e) => sum + eventRevenue(e), 0) * 100
      ) / 100;
    }

    return point;
  });

  data.sort((a, b) => b.revenue - a.revenue);
  return data;
}

interface AnalyticsTabProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function AnalyticsTab({ searchParams }: AnalyticsTabProps) {
  const params = await searchParams;
  const scope = await resolveScopedSupabase();

  let events: Event[] = [];

  if (scope.kind !== "unauthorized") {
    const { data } = await scope.client
      .from("events")
      .select("*")
      .eq("user_id", scope.userId)
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

  // Filter events for comparison period.
  //
  // YTD normalization: when the user is viewing the current year in full-year
  // mode (selectedMonth === null) and comparing against a prior year, cap the
  // compare window to the same Jan..<current month> range. Otherwise the
  // delta compares 4 months of 2026 against 12 months of 2025 and produces
  // nonsense like "-87.3% vs 2025".
  const now = new Date();
  const isYTDCurrent =
    selectedMonth === null && selectedYear === currentYear;
  const ytdCapMonth = isYTDCurrent ? now.getMonth() : null;

  let compareEvents =
    compareEnabled && compareYear !== null
      ? filterEvents(events, compareYear, compareMonth)
      : null;
  if (compareEvents !== null && ytdCapMonth !== null && compareMonth === null) {
    compareEvents = compareEvents.filter((e) => {
      const d = new Date(e.event_date + "T00:00:00");
      return d.getMonth() <= ytdCapMonth;
    });
  }
  const compareMetrics =
    compareEvents !== null ? computeMetrics(compareEvents) : null;

  // Cost & profitability — only calculated for events with cost data
  const completedPeriod = completedOnly(periodEvents);
  const eventsWithCosts = completedPeriod.filter(
    (e) => e.food_cost !== null || e.labor_cost !== null || e.other_costs !== null
  );
  const totalFoodCost = eventsWithCosts.reduce((s, e) => s + (e.food_cost ?? 0), 0);
  const totalLaborCost = eventsWithCosts.reduce((s, e) => s + (e.labor_cost ?? 0), 0);
  const totalOtherCosts = eventsWithCosts.reduce((s, e) => s + (e.other_costs ?? 0), 0);
  const totalCosts = totalFoodCost + totalLaborCost + totalOtherCosts;
  const revenueForCostEvents = eventsWithCosts.reduce((s, e) => s + eventRevenue(e), 0);
  const profit = revenueForCostEvents - totalCosts;
  const profitMargin = revenueForCostEvents > 0 ? (profit / revenueForCostEvents) * 100 : null;
  const hasCostData = eventsWithCosts.length > 0;

  // Profitability by event type — requires cost data
  interface TypeProfitRow {
    type: string;
    count: number;
    avgRevenue: number;
    avgCosts: number;
    avgProfit: number;
    avgMargin: number;
  }
  const profitByType: TypeProfitRow[] = [];
  if (hasCostData) {
    const typeMap = new Map<string, { revenues: number[]; costs: number[] }>();
    for (const e of eventsWithCosts) {
      const type = e.event_type ?? "Untagged";
      if (!typeMap.has(type)) typeMap.set(type, { revenues: [], costs: [] });
      const g = typeMap.get(type)!;
      g.revenues.push(eventRevenue(e));
      g.costs.push((e.food_cost ?? 0) + (e.labor_cost ?? 0) + (e.other_costs ?? 0));
    }
    for (const [type, { revenues, costs }] of typeMap) {
      const n = revenues.length;
      const avgRev = revenues.reduce((a, b) => a + b, 0) / n;
      const avgCost = costs.reduce((a, b) => a + b, 0) / n;
      const avgProfit = avgRev - avgCost;
      const avgMargin = avgRev > 0 ? (avgProfit / avgRev) * 100 : 0;
      profitByType.push({ type, count: n, avgRevenue: avgRev, avgCosts: avgCost, avgProfit, avgMargin });
    }
    profitByType.sort((a, b) => b.avgMargin - a.avgMargin);
  }

  // Profitability by day of week — requires cost data
  interface DowProfitRow {
    day: string;
    count: number;
    avgRevenue: number;
    avgCosts: number;
    avgProfit: number;
    avgMargin: number;
  }
  const profitByDow: DowProfitRow[] = [];
  if (hasCostData) {
    const dowMap = new Map<number, { revenues: number[]; costs: number[] }>();
    for (const e of eventsWithCosts) {
      const dow = new Date(e.event_date + "T00:00:00").getDay();
      if (!dowMap.has(dow)) dowMap.set(dow, { revenues: [], costs: [] });
      const g = dowMap.get(dow)!;
      g.revenues.push(eventRevenue(e));
      g.costs.push((e.food_cost ?? 0) + (e.labor_cost ?? 0) + (e.other_costs ?? 0));
    }
    for (const [dow, { revenues, costs }] of dowMap) {
      const n = revenues.length;
      const avgRev = revenues.reduce((a, b) => a + b, 0) / n;
      const avgCost = costs.reduce((a, b) => a + b, 0) / n;
      const avgProfit = avgRev - avgCost;
      const avgMargin = avgRev > 0 ? (avgProfit / avgRev) * 100 : 0;
      profitByDow.push({ day: DAY_NAMES[dow], count: n, avgRevenue: avgRev, avgCosts: avgCost, avgProfit, avgMargin });
    }
    // Sort by day of week order
    const dowOrder = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    profitByDow.sort((a, b) => dowOrder.indexOf(a.day) - dowOrder.indexOf(b.day));
  }

  // Location / city breakdown — top cities by avg revenue
  interface LocationRow {
    location: string;
    count: number;
    totalRevenue: number;
    avgRevenue: number;
  }
  const locationMap = new Map<string, { revenues: number[] }>();
  for (const e of completedPeriod) {
    const loc = e.location ?? e.city ?? null;
    if (!loc) continue;
    if (!locationMap.has(loc)) locationMap.set(loc, { revenues: [] });
    locationMap.get(loc)!.revenues.push(eventRevenue(e));
  }
  const locationRows: LocationRow[] = Array.from(locationMap.entries())
    .map(([location, { revenues }]) => ({
      location,
      count: revenues.length,
      totalRevenue: revenues.reduce((a, b) => a + b, 0),
      avgRevenue: revenues.reduce((a, b) => a + b, 0) / revenues.length,
    }))
    .filter((r) => r.count >= 1)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 15);

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
      : ytdCapMonth !== null
        ? `Jan–${MONTH_SHORT[ytdCapMonth]} ${selectedYear}`
        : `${selectedYear}`;
  const comparePeriodLabel =
    compareEnabled && compareYear !== null
      ? compareMonth !== null
        ? `${MONTHS_FULL[compareMonth]} ${compareYear}`
        : ytdCapMonth !== null
          ? `Jan–${MONTH_SHORT[ytdCapMonth]} ${compareYear}`
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
      description: "Completed events with revenue",
    },
    {
      label: "Avg Per Event",
      value: formatCurrency(metrics.avgPerEvent),
      delta: compareMetrics
        ? delta(metrics.avgPerEvent, compareMetrics.avgPerEvent)
        : undefined,
      icon: TrendingUp,
      description: "Average revenue per event",
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
    ...(hasCostData
      ? [
          {
            label: "Profit",
            value: formatCurrency(profit),
            delta: undefined,
            icon: PiggyBank,
            description: profitMargin !== null
              ? `${profitMargin.toFixed(1)}% margin · ${eventsWithCosts.length} event${eventsWithCosts.length !== 1 ? "s" : ""} with costs`
              : `${eventsWithCosts.length} event${eventsWithCosts.length !== 1 ? "s" : ""} with costs`,
          },
        ]
      : []),
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

          {hasCostData && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank className="h-4 w-4" />
                  Cost Breakdown · {periodLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Based on {eventsWithCosts.length} event{eventsWithCosts.length !== 1 ? "s" : ""} with cost data entered.
                  Add costs to events via the Edit Event form.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Food Cost", value: totalFoodCost, pct: revenueForCostEvents > 0 ? (totalFoodCost / revenueForCostEvents) * 100 : 0, color: "text-orange-600" },
                    { label: "Labor Cost", value: totalLaborCost, pct: revenueForCostEvents > 0 ? (totalLaborCost / revenueForCostEvents) * 100 : 0, color: "text-blue-600" },
                    { label: "Other Costs", value: totalOtherCosts, pct: revenueForCostEvents > 0 ? (totalOtherCosts / revenueForCostEvents) * 100 : 0, color: "text-purple-600" },
                    { label: "Net Profit", value: profit, pct: profitMargin ?? 0, color: profit >= 0 ? "text-green-600" : "text-red-600" },
                  ].map(({ label, value, pct, color }) => (
                    <div key={label} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      <p className={`text-xl font-bold ${color}`}>
                        {formatCurrency(value)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {label === "Net Profit" ? "margin" : "of revenue"}: {pct.toFixed(1)}%
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {hasCostData && profitByType.length >= 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="h-4 w-4" />
                  Profitability by Event Type · {periodLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Sorted by average margin. Only events with cost data included.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left pb-2 font-medium">Event Type</th>
                        <th className="text-right pb-2 font-medium">Events</th>
                        <th className="text-right pb-2 font-medium">Avg Revenue</th>
                        <th className="text-right pb-2 font-medium hidden sm:table-cell">Avg Costs</th>
                        <th className="text-right pb-2 font-medium">Avg Profit</th>
                        <th className="text-right pb-2 font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {profitByType.map((row, i) => {
                        const isTop = i === 0;
                        return (
                          <tr key={row.type} className={isTop ? "bg-green-50/50 dark:bg-green-950/10" : ""}>
                            <td className="py-2.5 font-medium">
                              {row.type}
                              {isTop && (
                                <span className="ml-2 text-[10px] font-bold uppercase bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 rounded px-1.5 py-0.5">
                                  Best
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 text-right text-muted-foreground">{row.count}</td>
                            <td className="py-2.5 text-right">{formatCurrency(row.avgRevenue)}</td>
                            <td className="py-2.5 text-right text-muted-foreground hidden sm:table-cell">{formatCurrency(row.avgCosts)}</td>
                            <td className={`py-2.5 text-right font-medium ${row.avgProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
                              {formatCurrency(row.avgProfit)}
                            </td>
                            <td className="py-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                {row.avgMargin > (profitMargin ?? 0) ? (
                                  <ChevronUp className="h-3.5 w-3.5 text-green-600" />
                                ) : row.avgMargin < (profitMargin ?? 0) ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-red-500" />
                                ) : (
                                  <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <span className={`font-semibold ${row.avgMargin >= 30 ? "text-green-700 dark:text-green-400" : row.avgMargin >= 15 ? "text-yellow-700 dark:text-yellow-400" : "text-red-600"}`}>
                                  {row.avgMargin.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {profitMargin !== null && (
                  <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                    Overall average margin: <span className="font-medium">{profitMargin.toFixed(1)}%</span> across all event types
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {locationRows.length >= 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" />
                  Revenue by Location · {periodLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const maxRev = locationRows[0]?.totalRevenue ?? 1;
                  return (
                    <div className="space-y-2.5">
                      {locationRows.map((row) => (
                        <div key={row.location} className="flex items-center gap-3">
                          <span className="text-sm font-medium w-48 shrink-0 truncate" title={row.location}>
                            {row.location}
                          </span>
                          <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full"
                              style={{ width: `${Math.max((row.totalRevenue / maxRev) * 100, 3)}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold w-24 text-right shrink-0">
                            {formatCurrency(row.totalRevenue)}
                          </span>
                          <span className="text-xs text-muted-foreground w-20 text-right shrink-0 hidden sm:block">
                            {formatCurrency(row.avgRevenue)} avg · {row.count}×
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {hasCostData && profitByDow.length >= 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Star className="h-4 w-4" />
                  Profitability by Day of Week · {periodLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                  {profitByDow.map((row) => (
                    <div key={row.day} className="rounded-lg border bg-muted/30 p-3 space-y-1 text-center">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{row.day}</p>
                      <p className={`text-lg font-bold ${row.avgMargin >= 30 ? "text-green-700 dark:text-green-400" : row.avgMargin >= 15 ? "text-yellow-700 dark:text-yellow-400" : "text-red-600"}`}>
                        {row.avgMargin.toFixed(0)}%
                      </p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(row.avgProfit)} avg</p>
                      <p className="text-xs text-muted-foreground">{row.count} event{row.count !== 1 ? "s" : ""}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
