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
} from "lucide-react";
import { DashboardCharts } from "./dashboard-charts";
import { SetupProgress } from "@/components/setup-progress";
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
      {profile?.onboarding_completed && (
        <SetupProgress
          hasEvents={hasEvents}
          hasSales={hasSales}
          hasPOS={posConnected}
          has10Events={has10Events}
        />
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
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <CalendarDays className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <div>
              <h2 className="text-xl font-semibold mb-2">Welcome to TruckCast!</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Your dashboard will populate as you add events. Start by adding your first event to begin tracking revenue and generating forecasts.
              </p>
            </div>
            <Link href="/dashboard/events?new=true">
              <Button size="lg" className="gap-2 mt-2">
                <Plus className="h-4 w-4" />
                Add Your First Event
              </Button>
            </Link>
          </CardContent>
        </Card>
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
