import type { Metadata } from "next";
export const metadata: Metadata = { title: "Dashboard" };

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveScopedSupabase, canSeeFinancials } from "@/lib/dashboard-scope";
import { stripFinancialFields } from "@/lib/event-financials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  CalendarCheck,
  TrendingUp,
  CalendarDays,
  Target,
  BarChart3,
  PiggyBank,
  Plus,
  ClipboardList,
  Upload,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { DashboardCharts } from "./dashboard-charts";
import { DashboardHeroChart } from "./hero-chart";
import { SetupProgress } from "@/components/setup-progress";
import { PosNudgeBanner } from "@/components/pos-nudge-banner";
import { DashboardForecastCard } from "@/components/dashboard-forecast-card";
import { DayOfEventBlock } from "@/components/day-of-event-block";
import {
  getMostRecentForecastResult,
  getThisMonthAccuracy,
} from "@/lib/forecast-vs-actual";
import { DunningBanner } from "@/components/dunning-banner";
import { JourneyCallout } from "@/components/journey-callout";
import { KeyTakeaways } from "@/components/key-takeaways";
import { SampleDataSeedButton, SampleDataBanner } from "@/components/sample-data-controls";
import { SeeForecastsTile } from "@/components/see-forecasts-tile";
import { computeJourneyState } from "@/lib/user-journey";
import { computeReportsAggregates } from "@/lib/reports-aggregates";
import type { Event, EventPerformance } from "@/lib/database.types";

function formatCurrency(val: number): string {
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Total recognised revenue for an event: on-site sales + catering invoice */
function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
}

/** True if an event has any recognised revenue */
function hasRevenue(e: Event): boolean {
  return (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && e.invoice_revenue > 0);
}

export default async function DashboardPage() {
  const scope = await resolveScopedSupabase();
  const financialsVisible =
    scope.kind === "unauthorized" ? true : canSeeFinancials(scope);

  let profile = null;
  let events: Event[] = [];
  let performances: EventPerformance[] = [];
  let posConnected = false;
  let scopedClient: SupabaseClient | null = null;
  let scopedUserId: string | null = null;

  if (scope.kind !== "unauthorized") {
    scopedClient = scope.client;
    scopedUserId = scope.userId;
    const [profileRes, eventsRes, perfRes, posRes] = await Promise.all([
      scope.client.from("profiles").select("*").eq("id", scope.userId).single(),
      scope.client
        .from("events")
        .select("*")
        .eq("user_id", scope.userId)
        .order("event_date", { ascending: false }),
      scope.client
        .from("event_performance")
        .select("*")
        .eq("user_id", scope.userId)
        .order("avg_sales", { ascending: false }),
      scope.client
        .from("pos_connections")
        .select("id")
        .eq("user_id", scope.userId)
        .limit(1),
    ]);
    profile = profileRes.data;
    const rawEvents = (eventsRes.data ?? []) as Event[];
    // Manager-without-Financials: strip dollar columns server-side.
    // Downstream aggregates (ytdRevenue, projectedSeason, kpis) all
    // collapse to zero, but we also gate the financial sections on
    // financialsVisible below — the strip is defense-in-depth.
    events = financialsVisible ? rawEvents : rawEvents.map(stripFinancialFields);
    performances = financialsVisible
      ? ((perfRes.data ?? []) as EventPerformance[])
      : [];
    posConnected = (posRes.data ?? []).length > 0;
  }

  // Key Takeaways aggregates — shared library, single source of truth with
  // the Reports tab inside /dashboard/insights.
  const reportsAggregates = computeReportsAggregates(events, performances);

  const today = new Date().toISOString().split("T")[0];
  const currentYear = new Date().getFullYear();

  // Forecast-vs-actual rollups for the dashboard forecast card. The
  // card surfaces above SetupProgress as the "aha moment" retention
  // signal — operator logs a sale, sees how the forecast did right
  // at the top of their next dashboard load. Empty for fresh accounts.
  const recentForecastResult = getMostRecentForecastResult(events, today);
  const monthAccuracy = getThisMonthAccuracy(events, today);

  // Setup progress checks
  const hasEvents = events.length > 0;
  const hasSales = events.some(
    (e) => e.event_date <= today && hasRevenue(e)
  );
  const has10Events = events.length >= 10;

  // Journey state
  const journeyContext = computeJourneyState(
    events.map((e) => ({
      booked: e.booked,
      net_sales: e.net_sales,
      invoice_revenue: e.invoice_revenue,
      event_mode: e.event_mode,
      event_date: e.event_date,
    })),
    posConnected
  );

  // KPI calculations
  // Linked carry-over events (e.g., Sunday cancelled because Saturday sold
  // out — carries caused_by_event_id pointing at Saturday) drop out at the
  // completed-events filter so they don't drag down forecast accuracy or
  // YTD totals. Saturday's overrun is the credited outcome.
  const bookedEvents = events.filter((e) => e.booked);
  const completedEvents = bookedEvents.filter(
    (e) => e.event_date <= today && !e.caused_by_event_id && hasRevenue(e)
  );
  const ytdEvents = completedEvents.filter(
    (e) => new Date(e.event_date + "T00:00:00").getFullYear() === currentYear
  );
  const ytdRevenue = ytdEvents.reduce((sum, e) => sum + eventRevenue(e), 0);
  const eventsCompleted = ytdEvents.length;
  const avgTicket = eventsCompleted > 0 ? ytdRevenue / eventsCompleted : 0;

  // Mode breakdown — only shown when user has both food truck and catering events
  const ytdTruck = ytdEvents.filter((e) => e.event_mode !== "catering");
  const ytdCatering = ytdEvents.filter((e) => e.event_mode === "catering");
  const showModeBreakdown = ytdTruck.length > 0 && ytdCatering.length > 0;
  const modeBreakdown = showModeBreakdown
    ? {
        truck: {
          revenue: ytdTruck.reduce((s, e) => s + eventRevenue(e), 0),
          count: ytdTruck.length,
          avg:
            ytdTruck.reduce((s, e) => s + eventRevenue(e), 0) /
            ytdTruck.length,
        },
        catering: {
          revenue: ytdCatering.reduce((s, e) => s + eventRevenue(e), 0),
          count: ytdCatering.length,
          avg:
            ytdCatering.reduce((s, e) => s + eventRevenue(e), 0) /
            ytdCatering.length,
        },
      }
    : null;
  // Unlogged past events — exactly mirrors the Needs Attention tab filter in events-client.tsx
  // net_sales === null (not just falsy) so explicitly logged $0 events are excluded.
  // pre_settled events are NOT excluded — operators routinely append walk-up sales
  // on top of the contract, so a pre_settled event with no logged sales is a
  // legitimate "needs attention" candidate (matches events-client.tsx 2026-05-02 fix).
  const unloggedEvents = events
    .filter((e) =>
      e.event_date < today &&
      e.booked &&
      !e.cancellation_reason &&
      e.net_sales === null &&
      !(e.event_mode === "catering" && e.invoice_revenue > 0) &&
      e.anomaly_flag !== "disrupted"
    )
    .sort((a, b) => b.event_date.localeCompare(a.event_date)); // most recent first

  // Cancelled-but-future-dated bookings drop out of "upcoming" — the
  // tile and forecast-sum should reflect what the operator can still
  // act on, not bookings that fell through. Mirrors the events-tab
  // Upcoming filter in src/lib/events-chips.ts.
  const upcomingEvents = bookedEvents.filter(
    (e) => e.event_date > today && !e.cancellation_reason
  );
  const upcomingCount = upcomingEvents.length;
  const upcomingForecastSum = upcomingEvents.reduce(
    (sum, e) => sum + (e.forecast_sales ?? 0),
    0
  );

  // Weather-not-set candidates: upcoming events within 7 days that
  // have a city (so weather lookup is even possible) but no
  // event_weather selected. Surfacing this on the dashboard nudges
  // the operator to pick a forecast on time so the prep + staffing
  // call lines up with reality. Sorted by date ascending so the
  // soonest-needing-attention event surfaces first.
  const sevenDaysOut = new Date(today + "T00:00:00");
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const sevenDaysOutIso = sevenDaysOut.toISOString().split("T")[0];
  const weatherNotSetEvents = upcomingEvents
    .filter(
      (e) =>
        e.event_date <= sevenDaysOutIso &&
        !e.event_weather &&
        (e.city ?? "").trim() !== ""
    )
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const projectedSeason = ytdRevenue + upcomingForecastSum;

  // YTD profitability — only calculated when at least some events have cost data
  const ytdEventsWithCosts = ytdEvents.filter(
    (e) => e.food_cost !== null || e.labor_cost !== null || e.other_costs !== null
  );
  const ytdTotalCosts = ytdEventsWithCosts.reduce(
    (sum, e) => sum + (e.food_cost ?? 0) + (e.labor_cost ?? 0) + (e.other_costs ?? 0),
    0
  );
  const ytdCostableRevenue = ytdEventsWithCosts.reduce((sum, e) => sum + eventRevenue(e), 0);
  const ytdProfit = ytdCostableRevenue - ytdTotalCosts;
  const ytdMargin = ytdCostableRevenue > 0 ? (ytdProfit / ytdCostableRevenue) * 100 : null;
  const showProfitKpi = ytdEventsWithCosts.length > 0;

  // Forecast accuracy — weighted MAPE (revenue-weighted so small events don't skew the metric)
  // Each event's error is weighted by its actual revenue, so a $5,000 event counts far more
  // than a $50 event. This matches the "within 16% aggregate" claim on the landing page.
  const eventsWithBoth = completedEvents.filter(
    (e) => e.forecast_sales !== null && e.forecast_sales > 0 && eventRevenue(e) > 0
  );
  let forecastAccuracy = "N/A";
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

  // "Here's why" operator-action levers — count events with missing
  // fields that could improve forecast quality. Operator decision
  // 2026-05-10: surface these alongside the hit rate as actionable
  // teaching moments rather than just a stat.
  //
  // Counts cover all events the operator could fix (booked, not
  // cancelled, not anomaly-flagged disrupted). The chip system at
  // /dashboard/events already has filters for missing-weather,
  // missing-type, missing-sales — links use ?missing=X URL pattern
  // (see lib/events-chips.ts legacyUrlMapping).
  const actionableEvents = bookedEvents.filter(
    (e) => !e.cancellation_reason && e.anomaly_flag !== "disrupted"
  );
  const missingWeatherCount = actionableEvents.filter((e) => !e.event_weather).length;
  const missingTypeCount = actionableEvents.filter((e) => !e.event_type).length;
  // Past events without sales — only count where sales is the right
  // signal (food_truck/vending; catering uses invoice_revenue).
  const missingSalesCount = actionableEvents.filter(
    (e) =>
      e.event_date < today &&
      e.net_sales === null &&
      !(e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0)
  ).length;
  const totalGaps = missingWeatherCount + missingTypeCount + missingSalesCount;

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
      .filter((e) => hasRevenue(e))
      .reduce((sum, e) => sum + eventRevenue(e), 0);
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
    typeMap.set(t, (typeMap.get(t) ?? 0) + eventRevenue(e));
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
      description: `${currentYear} total revenue`,
    },
    {
      label: "Events Completed",
      value: eventsCompleted.toString(),
      icon: CalendarCheck,
      description: `Booked events with revenue in ${currentYear}`,
    },
    {
      label: "Avg Per Event",
      value: formatCurrency(avgTicket),
      icon: TrendingUp,
      description: "Average revenue per event",
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
      // "In-range hit rate" framing per durable rule (CLAUDE.md): never
      // use "X% accuracy" — parses as "wrong (100-X)% of the time."
      // What this stat actually measures: percentage of past events
      // where the actual sales landed within the forecast's stated
      // range.
      //
      // The "here's why" operator-action levers (when there are gaps)
      // turn the stat from a passive number into a teaching moment.
      // Each link goes to the corresponding Needs Attention chip
      // filter via lib/events-chips legacyUrlMapping.
      label: "In-range hit rate",
      value: forecastAccuracy,
      icon: BarChart3,
      description:
        eventsWithBoth.length < 3 ? (
          "Need 3+ past events with forecasts to measure"
        ) : totalGaps === 0 ? (
          `Based on ${eventsWithBoth.length} past events. Forecast quality looks complete — every event has weather, type, and sales logged.`
        ) : (
          <>
            Based on {eventsWithBoth.length} past events. Improve by filling in:{" "}
            {missingWeatherCount > 0 && (
              <>
                <Link
                  href="/dashboard/events?missing=weather"
                  className="text-brand-teal hover:underline"
                >
                  {missingWeatherCount} missing weather
                </Link>
                {(missingTypeCount > 0 || missingSalesCount > 0) && ", "}
              </>
            )}
            {missingTypeCount > 0 && (
              <>
                <Link
                  href="/dashboard/events?missing=type"
                  className="text-brand-teal hover:underline"
                >
                  {missingTypeCount} missing event type
                </Link>
                {missingSalesCount > 0 && ", "}
              </>
            )}
            {missingSalesCount > 0 && (
              <Link
                href="/dashboard/events?missing=sales"
                className="text-brand-teal hover:underline"
              >
                {missingSalesCount} past events without sales
              </Link>
            )}
            .
          </>
        ),
    },
    ...(showProfitKpi
      ? [
          {
            label: "YTD Profit",
            value: formatCurrency(ytdProfit),
            icon: PiggyBank,
            description: ytdMargin !== null
              ? `${ytdMargin.toFixed(1)}% margin · ${ytdEventsWithCosts.length} event${ytdEventsWithCosts.length !== 1 ? "s" : ""} with cost data`
              : `${ytdEventsWithCosts.length} event${ytdEventsWithCosts.length !== 1 ? "s" : ""} with cost data`,
          },
        ]
      : []),
  ];

  // Rolling 12-week data: 8 past weeks + current week + 3 future weeks
  function getMonday(d: Date): Date {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.getFullYear(), d.getMonth(), diff);
  }
  const rollingWeekData: { label: string; actual: number; forecast: number; isFuture: boolean }[] = [];
  const todayDateObj = new Date(today + "T00:00:00");
  const currentMonday = getMonday(todayDateObj);
  for (let w = -8; w <= 3; w++) {
    const weekStart = new Date(currentMonday);
    weekStart.setDate(currentMonday.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const wsStr = weekStart.toISOString().split("T")[0];
    const weStr = weekEnd.toISOString().split("T")[0];
    const isFuture = wsStr > today;
    const weekEvents = bookedEvents.filter((e) => e.event_date >= wsStr && e.event_date <= weStr);
    const actual = isFuture ? 0 : weekEvents.filter((e) => hasRevenue(e)).reduce((s, e) => s + eventRevenue(e), 0);
    const forecast = weekEvents.reduce((s, e) => s + (e.forecast_sales ?? 0), 0);
    rollingWeekData.push({
      label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      actual,
      forecast,
      isFuture,
    });
  }

  // Data completeness — only shown when user has 5+ past events.
  // event_tier is intentionally NOT scored: the EventForm doesn't surface it
  // as an input, so flagging it as "missing" is operationally meaningless.
  // Re-include if/when tier becomes user-editable.
  const pastBookedEvents = events.filter((e) => e.booked && e.event_date <= today);
  const dataQualityGaps: { label: string; count: number; href: string; field: string }[] = [];
  if (pastBookedEvents.length >= 5) {
    const missingType = pastBookedEvents.filter((e) => !e.event_type).length;
    const missingWeather = pastBookedEvents.filter((e) => !e.event_weather).length;
    const missingLocation = pastBookedEvents.filter((e) => !e.location && !e.city).length;
    if (missingType > 0) dataQualityGaps.push({ label: "Event Type", count: missingType, href: "/dashboard/events?tab=needs_attention&chips=missing-type", field: "type" });
    if (missingWeather > 0) dataQualityGaps.push({ label: "Weather", count: missingWeather, href: "/dashboard/events?tab=needs_attention&chips=missing-weather", field: "weather" });
    if (missingLocation > 0) dataQualityGaps.push({ label: "Address", count: missingLocation, href: "/dashboard/events?tab=needs_attention&chips=missing-location", field: "location" });
    dataQualityGaps.sort((a, b) => b.count - a.count);
  }
  const filledFields = pastBookedEvents.length >= 5
    ? pastBookedEvents.reduce((sum, e) => {
        let score = 0;
        if (e.event_type) score++;
        if (e.event_weather) score++;
        if (e.location || e.city) score++;
        return sum + score;
      }, 0)
    : 0;
  const totalFields = pastBookedEvents.length * 3;
  const dataScore = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 100;
  const showDataQuality = pastBookedEvents.length >= 5 && dataScore < 85 && dataQualityGaps.length > 0;

  const isNewUser = events.length === 0;
  // Sample-data preview state: count is_sample rows for the banner +
  // whether to show the seed CTA on the empty-dashboard layout.
  const sampleEventCount = events.filter((e) => e.is_sample).length;

  return (
    // Phase 6 visual polish 2026-05-02: bumped space-y from 6 to 8 for
    // more breathing room between dashboard sections. Matches the more
    // airy feel of Brad's New Dashboard 4-24-26 mockup. Easy revert if
    // it reads too sparse.
    <div className="space-y-8">
      <DunningBanner
        status={profile?.last_payment_status ?? null}
        failureReason={profile?.last_payment_failure_reason ?? null}
      />

      {/* Sample-data preview banner — renders whenever the operator has
          any is_sample=true rows. Reminds them they're in preview and
          gives one-click clear. */}
      {sampleEventCount > 0 && (
        <SampleDataBanner count={sampleEventCount} />
      )}

      {scopedClient && scopedUserId && (
        <DayOfEventBlock
          events={events}
          timezone={profile?.timezone ?? "America/Chicago"}
          supabase={scopedClient}
          userId={scopedUserId}
          subscriptionTier={profile?.subscription_tier ?? "starter"}
          canSeeFinancials={financialsVisible}
        />
      )}

      {/* Forecast card — "aha moment" retention surface. Renders only
          when the operator has at least one past event with both
          forecast + actual logged. Hidden for fresh accounts (no
          past forecasts to show against actuals). */}
      <DashboardForecastCard
        recent={recentForecastResult}
        monthAccuracy={monthAccuracy}
      />

      <SetupProgress
        hasEvents={hasEvents}
        hasSales={hasSales}
        hasPOS={posConnected}
        has10Events={has10Events}
        journeyContext={journeyContext}
      />

      {/* Contextual POS nudge — fires when the operator has logged
          sales manually but hasn't connected a POS yet. Pro+ only
          (Starter doesn't get POS integration). Replaces the
          previous onboarding-wizard step 3 which was getting
          skipped almost universally. The right moment to ask is
          right after manual sales entry, not at signup. */}
      <PosNudgeBanner
        posEligible={
          (profile?.subscription_tier ?? "starter") === "pro" ||
          (profile?.subscription_tier ?? "starter") === "premium"
        }
        posConnected={posConnected}
        hasSales={hasSales}
      />

      <JourneyCallout journeyContext={journeyContext} />

      {showDataQuality && (
        // Phase 4 design: data-quality nudge migrated indigo → brand-teal.
        // Positive encouragement, not a warning — fits "default brand
        // presence" per Verdict #25.
        <div className="rounded-lg border border-brand-teal/30 bg-brand-teal/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-teal shrink-0" />
              <p className="text-sm font-medium text-brand-teal">
                Forecasts get tighter as your data fills in — yours is {dataScore}% complete
              </p>
            </div>
            <Link href="/dashboard/events?tab=past">
              <Button variant="outline" size="sm" className="text-xs border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10 shrink-0">
                Fill gaps
              </Button>
            </Link>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {dataQualityGaps.slice(0, 4).map((gap) => (
              <Link key={gap.field} href={gap.href} className="text-xs text-brand-teal hover:underline">
                {gap.count} event{gap.count !== 1 ? "s" : ""} missing <span className="font-medium">{gap.label}</span>
              </Link>
            ))}
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
            Your operations at a glance
          </p>
        </div>
        <Link href="/dashboard/events?new=true">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </Link>
      </div>

      {!financialsVisible ? (
        /* Manager-without-Financials view: keep operations surfaces
           above (DayOfEventBlock, SetupProgress, JourneyCallout) and
           drop the entire revenue-heavy section. Replacing it with a
           short note frames the gating as deliberate (not a bug or a
           missing-data state). */
        <div className="rounded-lg border border-muted bg-muted/30 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Operations view</p>
          <p className="mt-1">
            Revenue, forecasts, and post-event sales entry are hidden because your owner has not granted Financials access. Events, inquiries, calendar, and notes remain available.
          </p>
        </div>
      ) : isNewUser ? (
        /* ── Getting-started layout for new users ── */
        <div className="space-y-6">
          {/* Phase 4 design: getting-started hero migrated orange/amber
              raw palette → brand-orange tint. Welcome / first-action
              moment legitimately gets the differentiator color per
              Verdict #25 (orange = closer / call-to-action accents). */}
          <div className="rounded-xl border border-brand-orange/20 bg-gradient-to-br from-brand-orange/10 to-brand-orange/5 p-6 md:p-8">
            <h2 className="text-xl font-bold mb-1">Let&apos;s get your first forecast ready 🚚</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Pick the fastest path to get started:
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Option 1 — Import (recommended) */}
              <Link href="/dashboard/integrations?tab=csv-import" className="group">
                <div className="h-full rounded-xl border-2 border-primary/30 bg-card p-5 hover:border-primary hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="font-semibold text-sm">Import from CSV</p>
                    <span className="text-[10px] font-bold uppercase bg-primary text-primary-foreground rounded px-1.5 py-0.5">Fastest</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Have events in Airtable, Square, or a spreadsheet? Drag in your CSV and VendCast auto-detects the columns.
                  </p>
                  <p className="text-xs font-medium text-primary mt-3 flex items-center gap-1 group-hover:gap-2 transition-all">
                    Import events <ArrowRight className="h-3.5 w-3.5" />
                  </p>
                </div>
              </Link>

              {/* Option 2 — Add manually */}
              <Link href="/dashboard/events?new=true" className="group">
                <div className="h-full rounded-xl border bg-card p-5 hover:border-primary/50 hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-3">
                    <Plus className="h-5 w-5 text-foreground" />
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

              {/* Option 3 — Forecasts preview. Triggers sample-data
                  seed instead of linking to the empty forecasts tab
                  (A4 fix from v60 brief queue — prior fresh-account
                  click landed on an empty page). */}
              <SeeForecastsTile />
            </div>
          </div>

          {/* Sample-data preview CTA — lets operators see VendCast's
              full UX before importing their own data. Reduces empty-
              dashboard bounce per v33 brief suggestion #1. */}
          <SampleDataSeedButton />

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
          {/* ── Season Progress Hero — first thing users see ── */}
          <div className="rounded-xl border bg-gradient-to-br from-brand-orange/5 to-brand-orange/10 dark:from-brand-orange/10 dark:to-brand-orange/[0.05] p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Season Progress · {currentYear}
              </p>
              <p className="text-xs text-muted-foreground">
                {eventsCompleted} done · {upcomingCount} upcoming
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6 mb-5">
              <div>
                <div className="text-3xl font-bold tracking-tight">
                  {formatCurrency(ytdRevenue)}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Revenue so far</p>
              </div>
              <div>
                <div className="text-3xl font-bold tracking-tight text-muted-foreground">
                  {formatCurrency(projectedSeason)}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Projected total</p>
              </div>
            </div>
            {projectedSeason > 0 && (
              <div>
                <div className="w-full bg-brand-orange/20 dark:bg-brand-orange/10 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-brand-orange h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.round((ytdRevenue / projectedSeason) * 100))}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {Math.round((ytdRevenue / projectedSeason) * 100)}% of projected season earned
                  {upcomingForecastSum > 0 && (
                    <span className="ml-1">· {formatCurrency(upcomingForecastSum)} in upcoming forecasts</span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* ── Key Takeaways — promoted from Reports ── */}
          <KeyTakeaways
            dayOfWeekSummaries={reportsAggregates.dayOfWeekSummaries}
            eventTypeBreakdown={reportsAggregates.eventTypeBreakdown}
            monthlySummaries={reportsAggregates.monthlySummaries}
            yoyData={reportsAggregates.yoyData}
            bestEventName={reportsAggregates.bestEventName}
            bestEventRevenue={reportsAggregates.bestEventRevenue}
            overallAvg={reportsAggregates.overallAvg}
          />

          {/* ── Rolling 12-Week Hero Chart ── */}
          <DashboardHeroChart rollingWeekData={rollingWeekData} />

          {/* ── Needs Attention — demoted from top-of-page banner to a
               mid-dashboard card. Three-slot structure: revenue logging,
               unmatched payments (Phase 3), weather-not-set (Phase 3). ── */}
          {unloggedEvents.length > 0 && (
            <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-brand-orange shrink-0" />
                  <p className="text-sm font-medium text-foreground">
                    Needs attention: {unloggedEvents.length} event{unloggedEvents.length !== 1 ? "s" : ""} need{unloggedEvents.length === 1 ? "s" : ""} revenue logged
                  </p>
                </div>
                <Link href="/dashboard/events?tab=needs_attention&chips=missing-sales">
                  <Button variant="outline" size="sm" className="text-xs border-brand-orange/40 hover:bg-brand-orange/10">
                    View all
                  </Button>
                </Link>
              </div>
              <div className="space-y-1">
                {unloggedEvents.slice(0, 4).map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground truncate mr-3">
                      {new Date(e.event_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" · "}
                      {e.event_name}
                      {e.event_mode === "catering" && (
                        <span className="ml-1.5 text-xs font-medium text-muted-foreground">(catering)</span>
                      )}
                    </span>
                    <Link href="/dashboard/events?tab=needs_attention&chips=missing-sales" className="text-xs font-medium text-brand-orange underline-offset-2 hover:underline shrink-0">
                      {e.event_mode === "catering" ? "Log invoice →" : "Log sales →"}
                    </Link>
                  </div>
                ))}
                {unloggedEvents.length > 4 && (
                  <p className="text-xs font-medium text-brand-orange pt-1">
                    +{unloggedEvents.length - 4} more
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Weather-not-set nudge: upcoming events within 7 days with
              a city set but no event_weather. Operators routinely
              forget to pick a forecast for next-week events; without
              one the forecast engine falls back to base/no-weather
              and the prep/staffing call drifts. */}
          {weatherNotSetEvents.length > 0 && (
            <div className="rounded-lg border border-brand-teal/30 bg-brand-teal/5 p-4 mt-4">
              <p className="text-sm font-medium text-foreground">
                Set weather: {weatherNotSetEvents.length} upcoming event
                {weatherNotSetEvents.length === 1 ? "" : "s"} within the next 7 days
                {" "}{weatherNotSetEvents.length === 1 ? "needs" : "need"} a weather pick
              </p>
              <div className="mt-2 space-y-1">
                {weatherNotSetEvents.slice(0, 4).map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-xs">
                    <Link
                      href="/dashboard/events?tab=upcoming"
                      className="font-medium text-foreground hover:text-brand-teal truncate"
                    >
                      {e.event_name}
                    </Link>
                    <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                      {new Date(e.event_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
                {weatherNotSetEvents.length > 4 && (
                  <p className="text-xs font-medium text-brand-teal pt-1">
                    +{weatherNotSetEvents.length - 4} more
                  </p>
                )}
              </div>
            </div>
          )}

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

          {modeBreakdown && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Revenue by Mode — {currentYear}
              </p>
              <div className="grid grid-cols-2 gap-4">
                {/* Food Truck */}
                <div className="rounded-lg border border-brand-orange/30 bg-brand-orange/[0.04] p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🚚</span>
                    <span className="text-sm font-semibold">Vending</span>
                  </div>
                  <div className="text-2xl font-bold">
                    {formatCurrency(modeBreakdown.truck.revenue)}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{modeBreakdown.truck.count} events</span>
                    <span>{formatCurrency(modeBreakdown.truck.avg)} avg</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div
                      className="bg-brand-orange h-1.5 rounded-full"
                      style={{
                        width: `${Math.round(
                          (modeBreakdown.truck.revenue /
                            (modeBreakdown.truck.revenue +
                              modeBreakdown.catering.revenue)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Catering */}
                <div className="rounded-lg border border-brand-teal/30 bg-brand-teal/[0.04] p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🍽️</span>
                    <span className="text-sm font-semibold">Catering</span>
                  </div>
                  <div className="text-2xl font-bold">
                    {formatCurrency(modeBreakdown.catering.revenue)}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{modeBreakdown.catering.count} events</span>
                    <span>
                      {formatCurrency(modeBreakdown.catering.avg)} avg
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div
                      className="bg-brand-teal h-1.5 rounded-full"
                      style={{
                        width: `${Math.round(
                          (modeBreakdown.catering.revenue /
                            (modeBreakdown.truck.revenue +
                              modeBreakdown.catering.revenue)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <DashboardCharts monthlyData={monthlyData} typeData={typeData} rollingWeekData={rollingWeekData} />
        </>
      )}
    </div>
  );
}
