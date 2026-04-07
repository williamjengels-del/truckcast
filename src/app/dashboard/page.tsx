import type { Metadata } from "next";
export const metadata: Metadata = { title: "Dashboard" };

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  CalendarCheck,
  TrendingUp,
  CalendarDays,
  Target,
  BarChart3,
  Plus,
  ClipboardList,
  Upload,
  ArrowRight,
} from "lucide-react";
import { DashboardCharts } from "./dashboard-charts";
import { SetupProgress } from "@/components/setup-progress";
import { JourneyCallout } from "@/components/journey-callout";
import { computeJourneyState } from "@/lib/user-journey";
import type { Event } from "@/lib/database.types";

function formatCurrency(val: number): string {
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  let events: Event[] = [];
  let posConnected = false;

  if (user) {
    const [profileRes, eventsRes, posRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("events")
        .select("*")
        .eq("user_id", user.id)
        .order("event_date", { ascending: false }),
      supabase
        .from("pos_connections")
        .select("id")
        .eq("user_id", user.id)
        .limit(1),
    ]);
    profile = profileRes.data;
    events = (eventsRes.data ?? []) as Event[];
    posConnected = (posRes.data ?? []).length > 0;
  }

  const today = new Date().toISOString().split("T")[0];
  const currentYear = new Date().getFullYear();

  // Setup progress checks
  const hasEvents = events.length > 0;
  const hasSales = events.some(
    (e) => e.event_date <= today && e.net_sales !== null && e.net_sales > 0
  );
  const has10Events = events.length >= 10;

  // Journey state
  const journeyContext = computeJourneyState(
    events.map((e) => ({
      booked: e.booked,
      net_sales: e.net_sales,
      event_date: e.event_date,
    })),
    posConnected
  );

  // KPI calculations
  const bookedEvents = events.filter((e) => e.booked);
  const completedEvents = bookedEvents.filter(
    (e) => e.event_date <= today && e.net_sales !== null && e.net_sales > 0
  );
  const ytdEvents = completedEvents.filter(
    (e) => new Date(e.event_date + "T00:00:00").getFullYear() === currentYear
  );
  const ytdRevenue = ytdEvents.reduce((sum, e) => sum + (e.net_sales ?? 0), 0);
  const eventsCompleted = ytdEvents.length;
  const avgTicket = eventsCompleted > 0 ? ytdRevenue / eventsCompleted : 0;
  // Unlogged past events — booked events in the past with no sales recorded
  const unloggedEvents = bookedEvents
    .filter((e) =>
      e.event_date < today &&
      (e.net_sales === null || e.net_sales === 0) &&
      e.fee_type !== "pre_settled"
    )
    .sort((a, b) => b.event_date.localeCompare(a.event_date)); // most recent first

  const upcomingEvents = bookedEvents.filter((e) => e.event_date > today);
  const upcomingCount = upcomingEvents.length;
  const upcomingForecastSum = upcomingEvents.reduce(
    (sum, e) => sum + (e.forecast_sales ?? 0),
    0
  );
  const projectedSeason = ytdRevenue + upcomingForecastSum;

  // Forecast accuracy (MAPE)
  const eventsWithBoth = completedEvents.filter(
    (e) => e.forecast_sales !== null && e.forecast_sales > 0
  );
  let forecastAccuracy = "N/A";
  if (eventsWithBoth.length >= 3) {
    const mape =
      eventsWithBoth.reduce((sum, e) => {
        const actual = e.net_sales ?? 0;
        const forecast = e.forecast_sales ?? 0;
        return sum + Math.abs(actual - forecast) / Math.max(actual, 1);
      }, 0) / eventsWithBoth.length;
    forecastAccuracy = `${Math.round((1 - mape) * 100)}%`;
  }

  // Monthly revenue data for chart
  const monthlyData: { month: string; actual: number; forecast: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const monthName = new Date(currentYear, m).toLocaleString("en-US", {
      month: "short",
    });
    const monthEvents = bookedEvents.filter((e) => {
      const d = new Date(e.event_date + "T00:00:00");
      return d.getFullYear() === currentYear && d.getMonth() === m;
    });
    const actual = monthEvents
      .filter((e) => e.net_sales !== null)
      .reduce((sum, e) => sum + (e.net_sales ?? 0), 0);
    const forecast = monthEvents.reduce(
      (sum, e) => sum + (e.forecast_sales ?? 0),
      0
    );
    monthlyData.push({ month: monthName, actual, forecast });
  }

  // Revenue by event type
  const typeData: { name: string; value: number }[] = [];
  const typeMap = new Map<string, number>();
  for (const e of completedEvents) {
    const t = e.event_type ?? "Other";
    typeMap.set(t, (typeMap.get(t) ?? 0) + (e.net_sales ?? 0));
  }
  for (const [name, value] of typeMap) {
    typeData.push({ name, value: Math.round(value) });
  }
  typeData.sort((a, b) => b.value - a.value);

  const kpis = [
    {
      label: "YTD Revenue",
      value: formatCurrency(ytdRevenue),
      icon: DollarSign,
      description: `${currentYear} net sales`,
    },
    {
      label: "Events Completed",
      value: eventsCompleted.toString(),
      icon: CalendarCheck,
      description: `Booked events with sales in ${currentYear}`,
    },
    {
      label: "Avg Per Event",
      value: formatCurrency(avgTicket),
      icon: TrendingUp,
      description: "Average net sales per event",
    },
    {
      label: "Upcoming Events",
      value: upcomingCount.toString(),
      icon: CalendarDays,
      description: "Booked future events",
    },
    {
      label: "Projected Season",
      value: formatCurrency(projectedSeason),
      icon: Target,
      description: "YTD + upcoming forecasts",
    },
    {
      label: "Forecast Accuracy",
      value: forecastAccuracy,
      icon: BarChart3,
      description:
        eventsWithBoth.length >= 3
          ? `Based on ${eventsWithBoth.length} events`
          : "Need 3+ events with forecasts",
    },
  ];

  const isNewUser = events.length === 0;

  return (
    <div className="space-y-6">
      <SetupProgress
        hasEvents={hasEvents}
        hasSales={hasSales}
        hasPOS={posConnected}
        has10Events={has10Events}
        journeyContext={journeyContext}
      />

      <JourneyCallout journeyContext={journeyContext} />

      {unloggedEvents.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0" />
              <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
                {unloggedEvents.length} event{unloggedEvents.length !== 1 ? "s" : ""} need{unloggedEvents.length === 1 ? "s" : ""} sales logged
              </p>
            </div>
            <Link href="/dashboard/events?tab=past">
              <Button variant="outline" size="sm" className="text-xs border-amber-300 hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/30">
                View all
              </Button>
            </Link>
          </div>
          <div className="space-y-1">
            {unloggedEvents.slice(0, 4).map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-amber-800 dark:text-amber-400 truncate mr-3">
                  {new Date(e.event_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {" · "}
                  {e.event_name}
                </span>
                <Link href="/dashboard/events?tab=past" className="text-xs text-amber-700 dark:text-amber-500 hover:underline shrink-0 font-medium">
                  Log sales →
                </Link>
              </div>
            ))}
            {unloggedEvents.length > 4 && (
              <p className="text-xs text-amber-700 dark:text-amber-500 pt-1">
                +{unloggedEvents.length - 4} more
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {profile?.business_name
              ? `${profile.business_name} Dashboard`
              : "Dashboard"}
          </h1>
          <p className="text-muted-foreground">
            Your event forecasting overview
          </p>
        </div>
        <Link href="/dashboard/events?new=true">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </Link>
      </div>

      {isNewUser ? (
        /* ── Getting-started layout for new users ── */
        <div className="space-y-6">
          <div className="rounded-xl border bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/10 p-6 md:p-8">
            <h2 className="text-xl font-bold mb-1">Let&apos;s get your first forecast ready 🚚</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Pick the fastest path to get started:
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Option 1 — Import (recommended) */}
              <Link href="/dashboard/events/import" className="group">
                <div className="h-full rounded-xl border-2 border-primary/30 bg-card p-5 hover:border-primary hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="font-semibold text-sm">Import from CSV</p>
                    <span className="text-[10px] font-bold uppercase bg-primary text-primary-foreground rounded px-1.5 py-0.5">Fastest</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Have events in Airtable, Square, or a spreadsheet? Drag in your CSV and TruckCast auto-detects the columns.
                  </p>
                  <p className="text-xs font-medium text-primary mt-3 flex items-center gap-1 group-hover:gap-2 transition-all">
                    Import events <ArrowRight className="h-3.5 w-3.5" />
                  </p>
                </div>
              </Link>

              {/* Option 2 — Add manually */}
              <Link href="/dashboard/events?new=true" className="group">
                <div className="h-full rounded-xl border bg-card p-5 hover:border-primary/50 hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center mb-3">
                    <Plus className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="font-semibold text-sm mb-1">Add an event manually</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Add an upcoming booking or a past event one at a time. Best if you&apos;re just getting started.
                  </p>
                  <p className="text-xs font-medium text-primary mt-3 flex items-center gap-1 group-hover:gap-2 transition-all">
                    Add event <ArrowRight className="h-3.5 w-3.5" />
                  </p>
                </div>
              </Link>

              {/* Option 3 — Forecasts preview */}
              <Link href="/dashboard/forecasts" className="group">
                <div className="h-full rounded-xl border bg-card p-5 hover:border-primary/50 hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center mb-3">
                    <TrendingUp className="h-5 w-5 text-indigo-600" />
                  </div>
                  <p className="font-semibold text-sm mb-1">See how forecasts work</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    With 10+ past events logged, TruckCast generates revenue forecasts calibrated to your truck&apos;s history.
                  </p>
                  <p className="text-xs font-medium text-primary mt-3 flex items-center gap-1 group-hover:gap-2 transition-all">
                    Explore forecasts <ArrowRight className="h-3.5 w-3.5" />
                  </p>
                </div>
              </Link>
            </div>
          </div>

          {/* Quick explainer */}
          <div className="grid gap-3 sm:grid-cols-3 text-center">
            {[
              { step: "1", label: "Add your events", detail: "Past + upcoming bookings" },
              { step: "2", label: "Log sales after each event", detail: "Keeps forecasts accurate" },
              { step: "3", label: "Get revenue forecasts", detail: "Built from your own history" },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-center gap-1 p-4 rounded-lg bg-muted/40">
                <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  {s.step}
                </span>
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <p className="text-xs text-muted-foreground mt-1">
                    {kpi.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <DashboardCharts monthlyData={monthlyData} typeData={typeData} />
        </>
      )}
    </div>
  );
}
