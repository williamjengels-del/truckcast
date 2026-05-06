"use client";

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Calendar,
  Tag,
  Target,
  ArrowRight,
} from "lucide-react";
import { EventBreakdownTable } from "./event-breakdown-table";
import { KeyTakeaways } from "@/components/key-takeaways";
import type {
  DayOfWeekSummary,
  EventTypeBreakdown,
  MonthlySummary,
  YoYData,
  Top10Row,
  LocationSummary,
  CompareEventRow,
  EventBreakdownRow,
  ReportsAggregates,
} from "@/lib/reports-aggregates";

// Re-export types so existing imports from reports-interactive keep resolving.
export type {
  DayOfWeekSummary,
  EventTypeBreakdown,
  MonthlySummary,
  YoYData,
  Top10Row,
  LocationSummary,
  CompareEventRow,
};

export type ReportsInteractiveProps = ReportsAggregates;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({
  totalRevenue,
  eventsCompleted,
  avgPerEvent,
  bestEventName,
  bestEventRevenue,
  forecastAccuracy,
}: {
  totalRevenue: number;
  eventsCompleted: number;
  avgPerEvent: number;
  bestEventName: string;
  bestEventRevenue: number;
  forecastAccuracy: string | null;
}) {
  const stats = [
    { label: "Total Revenue", value: formatCurrency(totalRevenue) },
    { label: "Events Completed", value: eventsCompleted.toString() },
    { label: "Average Per Event", value: formatCurrency(avgPerEvent) },
    {
      label: "Best Event",
      value: bestEventRevenue > 0 ? formatCurrency(bestEventRevenue) : "—",
      sub: bestEventName || undefined,
    },
    ...(forecastAccuracy
      ? [{ label: "Forecast Accuracy", value: forecastAccuracy }]
      : []),
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex-1 min-w-[140px] rounded-lg border bg-card px-4 py-3"
        >
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className="text-xl font-bold mt-0.5">{s.value}</p>
          {s.sub && (
            <p className="text-xs text-muted-foreground truncate max-w-[160px]">
              {s.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}


// ─── Collapsible Section ──────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left"
        type="button"
      >
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {summary && (
              <p className="text-sm text-muted-foreground mt-0.5">{summary}</p>
            )}
          </div>
          {open ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </CardHeader>
      </button>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─── Mini Bar Chart ──────────────────────────────────────────────────────────

function MiniBarChart({
  data,
}: {
  data: { value: number; color: string; label: string }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.label}: ${formatCurrency(d.value)}`}
          className="flex-1 rounded-t"
          style={{
            height: `${Math.max(4, (d.value / max) * 64)}px`,
            backgroundColor: d.color,
            minWidth: "6px",
          }}
        />
      ))}
    </div>
  );
}

// ─── Monthly Breakdown Section ────────────────────────────────────────────────

function MonthlyBreakdownSection({
  monthlySummaries,
}: {
  monthlySummaries: MonthlySummary[];
}) {
  const ytd = monthlySummaries.reduce((s, m) => s + m.totalRevenue, 0);
  const overallAvg =
    monthlySummaries.length > 0
      ? monthlySummaries.reduce((s, m) => s + m.avgRevenue, 0) /
        monthlySummaries.length
      : 0;

  const chartData = [...monthlySummaries]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.monthLabel.substring(0, 3) + " " + m.month.split("-")[0].slice(2),
      revenue: m.totalRevenue,
      aboveAvg: m.totalRevenue >= overallAvg * m.eventCount,
    }));

  return (
    <CollapsibleSection
      title="Monthly Breakdown"
      summary={ytd > 0 ? `${formatCurrency(ytd)} total across ${monthlySummaries.length} months` : undefined}
      defaultOpen={true}
    >
      {monthlySummaries.length === 0 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          Not enough data yet.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={chartData}>
                <XAxis dataKey="month" fontSize={11} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  formatter={(value: unknown) => [
                    `$${Number(value).toLocaleString()}`,
                    "Revenue",
                  ]}
                />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.aboveAvg ? "#0d4f5c" : "#94a3b8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">
            Green bars = above average month. Gray = below average.
          </p>
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
                  <TableCell className="text-right">{row.eventCount}</TableCell>
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
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Event Type Section ───────────────────────────────────────────────────────

function EventTypeSection({
  eventTypeBreakdown,
}: {
  eventTypeBreakdown: EventTypeBreakdown[];
}) {
  const total = eventTypeBreakdown.reduce((s, r) => s + r.totalRevenue, 0);
  const sorted = [...eventTypeBreakdown].sort(
    (a, b) => b.avgRevenue - a.avgRevenue
  );

  return (
    <CollapsibleSection
      title="By Event Type"
      summary={
        eventTypeBreakdown.length > 0
          ? `${eventTypeBreakdown.length} types · ${formatCurrency(total)} total`
          : undefined
      }
    >
      {eventTypeBreakdown.length === 0 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          Not enough data yet.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={sorted} layout="vertical">
                <XAxis
                  type="number"
                  fontSize={11}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <YAxis type="category" dataKey="eventType" fontSize={11} width={100} />
                <Tooltip
                  formatter={(value: unknown) => [
                    `$${Number(value).toLocaleString()}`,
                    "Avg Revenue",
                  ]}
                />
                <Bar dataKey="avgRevenue" fill="#e8621a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Day of Week Section ──────────────────────────────────────────────────────

const DAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function DayOfWeekSection({
  dayOfWeekSummaries,
}: {
  dayOfWeekSummaries: DayOfWeekSummary[];
}) {
  const best =
    dayOfWeekSummaries.length > 0
      ? [...dayOfWeekSummaries].sort((a, b) => b.avgRevenue - a.avgRevenue)[0]
      : null;

  const chartData = DAY_ORDER.map((day) => {
    const found = dayOfWeekSummaries.find((d) => d.day === day);
    return { day: day.slice(0, 3), avgRevenue: found?.avgRevenue ?? 0 };
  });

  return (
    <CollapsibleSection
      title="By Day of Week"
      summary={best ? `Best day: ${best.day} (${formatCurrency(best.avgRevenue)} avg)` : undefined}
    >
      {dayOfWeekSummaries.length === 0 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          Not enough data yet.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={chartData}>
                <XAxis dataKey="day" fontSize={12} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <Tooltip
                  formatter={(value: unknown) => [
                    `$${Number(value).toLocaleString()}`,
                    "Avg Revenue",
                  ]}
                />
                <Bar dataKey="avgRevenue" fill="#e8621a" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={
                        d.day === best?.day.slice(0, 3) ? "#0d4f5c" : "#e8621a"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
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
              {[...dayOfWeekSummaries]
                .sort((a, b) => b.avgRevenue - a.avgRevenue)
                .map((row, idx) => (
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
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Top Events Section ───────────────────────────────────────────────────────

function TopEventsSection({ top10 }: { top10: Top10Row[] }) {
  const chartData = [...top10]
    .sort((a, b) => b.avg_sales - a.avg_sales)
    .slice(0, 10)
    .map((p) => ({
      name:
        p.event_name.length > 20
          ? p.event_name.slice(0, 18) + "…"
          : p.event_name,
      avgRevenue: p.avg_sales,
    }));

  return (
    <CollapsibleSection
      title="Top Events"
      summary={
        top10.length > 0
          ? `Top ${top10.length} events by average revenue`
          : undefined
      }
    >
      {top10.length === 0 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          Not enough data yet.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={chartData} layout="vertical">
                <XAxis
                  type="number"
                  fontSize={11}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  fontSize={10}
                  width={110}
                />
                <Tooltip
                  formatter={(value: unknown) => [
                    `$${Number(value).toLocaleString()}`,
                    "Avg Revenue",
                  ]}
                />
                <Bar dataKey="avgRevenue" fill="#e8621a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Event Name</TableHead>
                <TableHead className="text-right">Times Booked</TableHead>
                <TableHead className="text-right">Avg Revenue</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top10.map((perf, idx) => (
                <TableRow key={perf.id}>
                  <TableCell className="text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{perf.event_name}</TableCell>
                  <TableCell className="text-right">
                    {perf.times_booked}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(perf.avg_sales)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(perf.total_sales)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Year over Year Section ────────────────────────────────────────────────────

function YoYSection({ yoyData }: { yoyData: YoYData[] }) {
  const now = new Date();
  const ytdLabel = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <CollapsibleSection
      title="Year over Year (YTD)"
      summary={
        yoyData.length >= 2
          ? `Jan 1–${ytdLabel} comparison across years`
          : "Needs 2+ years of data"
      }
    >
      {yoyData.length < 2 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          Year-over-year comparison requires events from multiple years.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Revenue (Jan 1–{ytdLabel})</TableHead>
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
                  <TableCell className="text-right">{row.eventCount}</TableCell>
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
                          yoyChange >= 0 ? "text-green-600" : "text-red-600"
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
    </CollapsibleSection>
  );
}

// ─── Event Performance Breakdown ─────────────────────────────────────────────

function EventPerformanceSection({
  eventBreakdownRows,
}: {
  eventBreakdownRows: EventBreakdownRow[];
}) {
  return (
    <CollapsibleSection
      title="Event Performance Breakdown"
      summary={`${eventBreakdownRows.length} completed events`}
    >
      <EventBreakdownTable rows={eventBreakdownRows} />
    </CollapsibleSection>
  );
}

// ─── Venue / Location Section ─────────────────────────────────────────────────

function VenueSection({
  locationSummaries,
}: {
  locationSummaries: LocationSummary[];
}) {
  const bestLocation = locationSummaries.length > 0 ? locationSummaries[0] : null;
  const worstLocation =
    locationSummaries.length > 1
      ? locationSummaries[locationSummaries.length - 1]
      : null;

  const chartData = locationSummaries
    .slice(0, 10)
    .map((l) => ({ city: l.city, avgRevenue: l.avgRevenue }));

  return (
    <CollapsibleSection
      title="Venue / Location Analysis"
      summary={
        locationSummaries.length > 0
          ? `${locationSummaries.length} locations · best: ${bestLocation?.city}`
          : undefined
      }
    >
      {locationSummaries.length === 0 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          Not enough data yet.
        </p>
      ) : (
        <div className="space-y-6">
          {(bestLocation || worstLocation) && (
            <div className="flex flex-wrap gap-3">
              {bestLocation && (
                <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3 flex-1 min-w-[200px]">
                  <p className="text-xs text-muted-foreground">
                    Best Performing Location
                  </p>
                  <p className="text-lg font-semibold">{bestLocation.city}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(bestLocation.totalRevenue)} total &middot;{" "}
                    {formatCurrency(bestLocation.avgRevenue)} avg &middot;{" "}
                    {bestLocation.eventCount} event
                    {bestLocation.eventCount !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
              {worstLocation && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 flex-1 min-w-[200px]">
                  <p className="text-xs text-muted-foreground">
                    Lowest Performing Location
                  </p>
                  <p className="text-lg font-semibold">{worstLocation.city}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(worstLocation.totalRevenue)} total &middot;{" "}
                    {formatCurrency(worstLocation.avgRevenue)} avg &middot;{" "}
                    {worstLocation.eventCount} event
                    {worstLocation.eventCount !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </div>
          )}
          {chartData.length > 1 && (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={chartData} layout="vertical">
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="city"
                    fontSize={11}
                    width={90}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [
                      `$${Number(value).toLocaleString()}`,
                      "Avg Revenue",
                    ]}
                  />
                  <Bar dataKey="avgRevenue" fill="#e8621a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
                  <TableCell className="text-right">{loc.eventCount}</TableCell>
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
    </CollapsibleSection>
  );
}

// ─── Compare Events Section ───────────────────────────────────────────────────

function CompareCard({
  row,
  isWinner,
}: {
  row: CompareEventRow;
  isWinner: boolean;
}) {
  const occurrenceData = row.occurrences.map((o, i) => ({
    label: `#${i + 1}`,
    value: o.net_sales,
    color:
      o.anomaly_flag === "disrupted"
        ? "#dc2626"
        : o.anomaly_flag === "boosted"
          ? "#0d4f5c"
          : "#e8621a",
  }));

  return (
    <div
      className={`flex-1 min-w-[240px] rounded-lg border p-4 space-y-3 ${
        isWinner ? "border-green-400 ring-1 ring-green-400" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-base">{row.event_name}</h3>
        {isWinner && (
          <Badge className="bg-green-600 hover:bg-green-700 text-xs shrink-0">
            Winner
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Times Booked</p>
          <p className="font-medium">{row.times_booked}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Avg Net Sales</p>
          <p className="font-medium">{formatCurrency(row.avg_sales)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Best</p>
          <p className="font-medium text-green-600">
            {formatCurrency(row.max_sales)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Worst</p>
          <p className="font-medium text-red-600">
            {formatCurrency(row.min_sales)}
          </p>
        </div>
        {row.consistency_score !== null && (
          <div>
            <p className="text-xs text-muted-foreground">Consistency</p>
            <p className="font-medium">
              {Math.round(row.consistency_score * 100)}%
            </p>
          </div>
        )}
        {row.forecast_next !== null && (
          <div>
            <p className="text-xs text-muted-foreground">Next Forecast</p>
            <p className="font-medium">{formatCurrency(row.forecast_next)}</p>
          </div>
        )}
      </div>
      {occurrenceData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Historical sales</p>
          <MiniBarChart data={occurrenceData} />
          <p className="text-xs text-muted-foreground mt-1">
            Blue=normal · Green=boosted · Red=disrupted
          </p>
        </div>
      )}
    </div>
  );
}

function CompareEventsSection({
  compareEventRows,
}: {
  compareEventRows: CompareEventRow[];
}) {
  const eventNames = useMemo(
    () => compareEventRows.map((r) => r.event_name),
    [compareEventRows]
  );

  const [eventA, setEventA] = useState<string>("");
  const [eventB, setEventB] = useState<string>("");
  const [compared, setCompared] = useState<{
    a: CompareEventRow;
    b: CompareEventRow;
  } | null>(null);

  function handleCompare() {
    const a = compareEventRows.find((r) => r.event_name === eventA);
    const b = compareEventRows.find((r) => r.event_name === eventB);
    if (a && b) setCompared({ a, b });
  }

  return (
    <CollapsibleSection
      title="Compare Events"
      summary="Side-by-side event comparison"
    >
      {compareEventRows.length < 2 ? (
        <p className="text-muted-foreground text-sm h-16 flex items-center justify-center">
          You need at least 2 events with performance data to compare.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">
                Event A
              </label>
              <Select value={eventA} onValueChange={(v) => setEventA(v ?? "")}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select event..." />
                </SelectTrigger>
                <SelectContent>
                  {eventNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">
                Event B
              </label>
              <Select value={eventB} onValueChange={(v) => setEventB(v ?? "")}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select event..." />
                </SelectTrigger>
                <SelectContent>
                  {eventNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleCompare}
              disabled={!eventA || !eventB || eventA === eventB}
              className="gap-2"
            >
              Compare <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {compared && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <CompareCard
                  row={compared.a}
                  isWinner={compared.a.avg_sales >= compared.b.avg_sales}
                />
                <CompareCard
                  row={compared.b}
                  isWinner={compared.b.avg_sales > compared.a.avg_sales}
                />
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium mb-1 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Verdict
                </p>
                <p className="text-sm text-muted-foreground">
                  {compared.a.avg_sales >= compared.b.avg_sales ? (
                    <>
                      Based on your history,{" "}
                      <strong>{compared.a.event_name}</strong> averages{" "}
                      {formatCurrency(compared.a.avg_sales - compared.b.avg_sales)}{" "}
                      more per booking than{" "}
                      <strong>{compared.b.event_name}</strong>.
                      {compared.a.consistency_score !== null &&
                        compared.b.consistency_score !== null && (
                          <>
                            {" "}
                            {compared.a.event_name} also has{" "}
                            {compared.a.consistency_score >=
                            compared.b.consistency_score
                              ? "higher"
                              : "lower"}{" "}
                            consistency (
                            {Math.round(compared.a.consistency_score * 100)}% vs{" "}
                            {Math.round(compared.b.consistency_score * 100)}%).
                          </>
                        )}
                    </>
                  ) : (
                    <>
                      Based on your history,{" "}
                      <strong>{compared.b.event_name}</strong> averages{" "}
                      {formatCurrency(compared.b.avg_sales - compared.a.avg_sales)}{" "}
                      more per booking than{" "}
                      <strong>{compared.a.event_name}</strong>.
                      {compared.a.consistency_score !== null &&
                        compared.b.consistency_score !== null && (
                          <>
                            {" "}
                            {compared.b.event_name} also has{" "}
                            {compared.b.consistency_score >=
                            compared.a.consistency_score
                              ? "higher"
                              : "lower"}{" "}
                            consistency (
                            {Math.round(compared.b.consistency_score * 100)}% vs{" "}
                            {Math.round(compared.a.consistency_score * 100)}%).
                          </>
                        )}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export function ReportsInteractive({
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
  overallAvg,
}: ReportsInteractiveProps) {
  return (
    <div className="space-y-4">
      {/* Task 3: Stats Bar */}
      <StatsBar
        totalRevenue={totalRevenue}
        eventsCompleted={eventsCompleted}
        avgPerEvent={avgPerEvent}
        bestEventName={bestEventName}
        bestEventRevenue={bestEventRevenue}
        forecastAccuracy={forecastAccuracy}
      />

      {/* Task 1: Key Takeaways */}
      <KeyTakeaways
        dayOfWeekSummaries={dayOfWeekSummaries}
        eventTypeBreakdown={eventTypeBreakdown}
        monthlySummaries={monthlySummaries}
        yoyData={yoyData}
        bestEventName={bestEventName}
        bestEventRevenue={bestEventRevenue}
        overallAvg={overallAvg}
      />

      {/* Collapsible sections */}
      <MonthlyBreakdownSection monthlySummaries={monthlySummaries} />
      <EventTypeSection eventTypeBreakdown={eventTypeBreakdown} />
      <DayOfWeekSection dayOfWeekSummaries={dayOfWeekSummaries} />
      <TopEventsSection top10={top10} />
      <YoYSection yoyData={yoyData} />
      <EventPerformanceSection eventBreakdownRows={eventBreakdownRows} />
      <VenueSection locationSummaries={locationSummaries} />

      {/* Task 2: Compare Events */}
      <CompareEventsSection compareEventRows={compareEventRows} />
    </div>
  );
}
