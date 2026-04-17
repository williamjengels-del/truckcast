import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  CalendarCheck,
  BarChart3,
  MapPin,
  CloudSun,
} from "lucide-react";
import { CONFIDENCE_COLORS, TREND_COLORS, TIER_COLORS } from "@/lib/constants";
import type { Event, EventPerformance } from "@/lib/database.types";
import { getDerivedTierDetails } from "@/lib/forecast-engine";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
}

function hasRevenue(e: Event): boolean {
  return (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0);
}

interface PageProps {
  params: Promise<{ name: string }>;
}

export default async function EventDrilldownPage({ params }: PageProps) {
  const { name } = await params;
  const eventName = decodeURIComponent(name);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: perfData }, { data: eventsData }] = await Promise.all([
    supabase
      .from("event_performance")
      .select("*")
      .eq("user_id", user.id)
      .eq("event_name", eventName)
      .single(),
    supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .ilike("event_name", eventName)
      .order("event_date", { ascending: false }),
  ]);

  const perf = perfData as EventPerformance | null;
  const allBookings = (eventsData ?? []) as Event[];

  // Split into completed (with revenue) and upcoming/unlogged
  const today = new Date().toISOString().split("T")[0];
  const completed = allBookings.filter((e) => e.booked && hasRevenue(e) && e.anomaly_flag !== "disrupted");
  const disrupted = allBookings.filter((e) => e.anomaly_flag === "disrupted");
  const upcoming = allBookings.filter((e) => e.event_date >= today && e.booked && !hasRevenue(e));
  const unlogged = allBookings.filter((e) => e.event_date < today && e.booked && !hasRevenue(e) && e.anomaly_flag !== "disrupted");

  // Revenue by year for trend view
  const revenueByYear = new Map<number, number[]>();
  for (const e of completed) {
    const yr = new Date(e.event_date + "T00:00:00").getFullYear();
    if (!revenueByYear.has(yr)) revenueByYear.set(yr, []);
    revenueByYear.get(yr)!.push(eventRevenue(e));
  }
  const yearStats = Array.from(revenueByYear.entries())
    .map(([year, revenues]) => {
      const total = revenues.reduce((a, b) => a + b, 0);
      const avg = total / revenues.length;
      return { year, count: revenues.length, total, avg };
    })
    .sort((a, b) => a.year - b.year);

  // Unique locations
  const locationCounts = new Map<string, { count: number; revenues: number[] }>();
  for (const e of completed) {
    const loc = e.location ?? e.city ?? "Unknown";
    if (!locationCounts.has(loc)) locationCounts.set(loc, { count: 0, revenues: [] });
    const g = locationCounts.get(loc)!;
    g.count++;
    g.revenues.push(eventRevenue(e));
  }
  const topLocations = Array.from(locationCounts.entries())
    .map(([loc, { count, revenues }]) => ({
      loc,
      count,
      avg: revenues.reduce((a, b) => a + b, 0) / revenues.length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const maxYearAvg = Math.max(...yearStats.map((y) => y.avg), 1);

  // Auto-derived tier from name-match history — the real input to scoring now.
  const tierDetails = getDerivedTierDetails(eventName, allBookings);

  // Legacy stored tier — preserved historical signal. Aggregate across all
  // past rows for this event name; show the most common non-null rating.
  const storedTierCounts = new Map<string, number>();
  for (const e of allBookings) {
    if (e.event_tier) {
      storedTierCounts.set(e.event_tier, (storedTierCounts.get(e.event_tier) ?? 0) + 1);
    }
  }
  const mostCommonStoredTier = [...storedTierCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0] ?? null;

  if (!perf && allBookings.length === 0) {
    redirect("/dashboard/performance");
  }

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <div>
        <Link
          href="/dashboard/performance"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Performance
        </Link>
        <h1 className="text-2xl font-bold">{eventName}</h1>
        <p className="text-muted-foreground text-sm">
          {allBookings.length} total booking{allBookings.length !== 1 ? "s" : ""} · {completed.length} with revenue logged
        </p>
      </div>

      {/* Stats summary */}
      {perf && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Avg Revenue</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(perf.avg_sales)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">median {formatCurrency(perf.median_sales)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Range</p>
              <p className="text-lg font-bold mt-1">{formatCurrency(perf.min_sales)}</p>
              <p className="text-xs text-muted-foreground">to {formatCurrency(perf.max_sales)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Consistency</p>
              <p className={`text-2xl font-bold mt-1 ${perf.consistency_score >= 0.7 ? "text-green-600" : perf.consistency_score >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                {(perf.consistency_score * 100).toFixed(0)}%
              </p>
              <Badge variant="secondary" className={`mt-1 text-xs ${CONFIDENCE_COLORS[perf.confidence] ?? ""}`}>
                {perf.confidence}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Trend</p>
              <div className="flex items-center gap-1.5 mt-1">
                {perf.trend === "Growing" ? (
                  <TrendingUp className="h-5 w-5 text-green-600" />
                ) : perf.trend === "Declining" ? (
                  <TrendingDown className="h-5 w-5 text-red-500" />
                ) : (
                  <Minus className="h-5 w-5 text-muted-foreground" />
                )}
                <span className={`text-base font-semibold ${TREND_COLORS[perf.trend] ?? ""}`}>
                  {perf.trend}
                </span>
              </div>
              {perf.yoy_growth !== null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {perf.yoy_growth > 0 ? "+" : ""}{(perf.yoy_growth * 100).toFixed(0)}% YoY
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Next Forecast</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(perf.forecast_next)}</p>
              {perf.confidence_band_low !== null && perf.confidence_band_high !== null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatCurrency(perf.confidence_band_low)} – {formatCurrency(perf.confidence_band_high)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tier signal: auto-derived vs. legacy stored rating.
          Auto-derived drives the confidence score; stored is historical. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-start gap-3">
            {tierDetails.tier ? (
              <Badge
                variant="outline"
                className={`text-base px-2.5 py-0.5 ${TIER_COLORS[tierDetails.tier] ?? ""}`}
              >
                {tierDetails.tier}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-base px-2.5 py-0.5 text-muted-foreground">
                —
              </Badge>
            )}
            <div className="text-sm">
              <div className="font-medium">
                {tierDetails.tier ? "Current signal" : "Not yet established"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {tierDetails.instances === 0
                  ? "No valid prior instances yet."
                  : `Auto-derived from ${tierDetails.instances} instance${tierDetails.instances === 1 ? "" : "s"} · ${(tierDetails.consistency * 100).toFixed(0)}% consistency.`}
                {!tierDetails.tier && tierDetails.instances > 0 && (
                  <> Needs ≥ 3 instances at ≥ 70% (A) or ≥ 2 at ≥ 50% (B).</>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
            <span>Your previous rating:</span>
            {mostCommonStoredTier ? (
              <Badge
                variant="outline"
                className={`text-[10px] ${TIER_COLORS[mostCommonStoredTier] ?? ""}`}
              >
                {mostCommonStoredTier}
              </Badge>
            ) : (
              <span className="italic">Not rated</span>
            )}
            <span className="text-[10px] opacity-70">(stored manually · no longer drives the score)</span>
          </div>
        </CardContent>
      </Card>

      {/* Year-over-year bar chart */}
      {yearStats.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              Revenue by Year
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {yearStats.map((ys) => (
                <div key={ys.year} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-12 shrink-0">{ys.year}</span>
                  <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded-full flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${Math.max((ys.avg / maxYearAvg) * 100, 4)}%` }}
                    >
                    </div>
                  </div>
                  <span className="text-sm font-semibold w-24 text-right shrink-0">{formatCurrency(ys.avg)}</span>
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{ys.count} event{ys.count !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top locations */}
      {topLocations.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              Locations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topLocations.map(({ loc, count, avg }) => (
                <div key={loc} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{loc}</span>
                    <span className="text-xs text-muted-foreground">{count}×</span>
                  </div>
                  <span className="text-sm font-semibold">{formatCurrency(avg)} avg</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming bookings */}
      {upcoming.length > 0 && (
        <Card className="border-blue-200 dark:border-blue-800/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-blue-700 dark:text-blue-400">
              <CalendarCheck className="h-4 w-4" />
              Upcoming ({upcoming.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {upcoming.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1">
                  <span className="font-medium">{formatDate(e.event_date)}</span>
                  <div className="flex items-center gap-2">
                    {e.location && <span className="text-xs text-muted-foreground">{e.location}</span>}
                    <span className="text-blue-700 dark:text-blue-400 font-medium">
                      {formatCurrency(e.forecast_sales)} forecast
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Booking history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudSun className="h-4 w-4" />
            Booking History ({completed.length} completed)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {completed.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No completed bookings with revenue logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Location</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead className="hidden md:table-cell">Weather</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Forecast</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">vs Forecast</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completed.map((e) => {
                    const rev = eventRevenue(e);
                    const diff = e.forecast_sales
                      ? ((rev - e.forecast_sales) / e.forecast_sales) * 100
                      : null;
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-sm font-medium">
                          {formatDate(e.event_date)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {e.location ?? e.city ?? "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {e.event_type ? (
                            <Badge variant="outline" className="text-xs">{e.event_type}</Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {e.event_weather ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(rev)}
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell text-sm text-muted-foreground">
                          {formatCurrency(e.forecast_sales)}
                        </TableCell>
                        <TableCell className="text-right hidden lg:table-cell text-sm">
                          {diff !== null ? (
                            <span className={diff >= 0 ? "text-green-600" : "text-red-500"}>
                              {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                            </span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disrupted events */}
      {disrupted.length > 0 && (
        <Card className="border-muted">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Disrupted / Excluded from Stats ({disrupted.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {disrupted.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm text-muted-foreground py-1 border-b last:border-0">
                  <span>{formatDate(e.event_date)}</span>
                  <span>{e.location ?? e.city ?? ""}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unlogged warning */}
      {unlogged.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/10 p-4 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            {unlogged.length} past booking{unlogged.length !== 1 ? "s" : ""} without revenue logged
          </p>
          <p className="text-amber-700 dark:text-amber-400 text-xs mt-1">
            Log sales for these events to improve forecast accuracy.
          </p>
          <Link href="/dashboard/events?tab=past" className="text-xs font-medium text-amber-700 hover:underline mt-2 inline-block">
            Go to Past Events →
          </Link>
        </div>
      )}
    </div>
  );
}
