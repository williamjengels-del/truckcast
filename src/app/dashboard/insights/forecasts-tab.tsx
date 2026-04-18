import { resolveScopedSupabase } from "@/lib/dashboard-scope";
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
import Link from "next/link";
import { CloudSun, Calculator, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import { getPlatformEvents } from "@/lib/platform-registry";
import type { Event } from "@/lib/database.types";
import { ForecastExplainer } from "./forecast-explainer";
import { WhatIfPanel } from "@/components/what-if-panel";
import { ForecastCard, ForecastInline } from "@/components/forecast-card";
import { isFixedRevenueEvent } from "@/lib/forecast-display";

function formatCurrency(val: number | null): string {
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

export async function ForecastsTab() {
  const scope = await resolveScopedSupabase();

  let events: Event[] = [];
  if (scope.kind !== "unauthorized") {
    const { data } = await scope.client
      .from("events")
      .select("*")
      .eq("user_id", scope.userId)
      .order("event_date", { ascending: true });
    events = (data ?? []) as Event[];
  }

  const today = new Date().toISOString().split("T")[0];
  const upcomingEvents = events.filter(
    (e) => e.event_date >= today && e.booked
  );

  // Unbooked potential events — sorted soonest first
  const unbookedEvents = events
    .filter((e) => e.event_date >= today && !e.booked)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  // Calibrate per-user coefficients
  const calibrated = calibrateCoefficients(events);

  // Fetch platform data for upcoming events (matches recalculate.ts for consistency)
  const upcomingNames = [...new Set(upcomingEvents.map((e) => e.event_name))];
  const platformMap = await getPlatformEvents(upcomingNames).catch(
    () => new Map<string, import("@/lib/database.types").PlatformEvent>()
  );

  // Calculate event-type averages from historical data (for What-If panel)
  const eventTypeAvgs: Record<string, number> = {};
  const pastEvents = events.filter(
    (e) =>
      e.booked &&
      e.anomaly_flag !== "disrupted" &&
      ((e.net_sales !== null && e.net_sales > 0) ||
        (e.event_mode === "catering" && e.invoice_revenue > 0))
  );
  const typeGroups: Record<string, number[]> = {};
  for (const e of pastEvents) {
    if (e.event_type) {
      if (!typeGroups[e.event_type]) typeGroups[e.event_type] = [];
      const rev = (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
      typeGroups[e.event_type].push(rev);
    }
  }
  for (const [type, sales] of Object.entries(typeGroups)) {
    eventTypeAvgs[type] = Math.round(sales.reduce((a, b) => a + b, 0) / sales.length);
  }

  // Calculate forecasts with details — include platform data so numbers match stored forecast_sales
  const forecastDetails = upcomingEvents.map((event) => {
    const platformEvent = platformMap.get(event.event_name.toLowerCase().trim()) ?? null;
    const result = calculateForecast(event, events, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    return {
      event,
      forecast: result,
    };
  });

  const totalForecast = forecastDetails.reduce(
    (sum, fd) => sum + (fd.forecast?.forecast ?? fd.event.forecast_sales ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Forecasts</h1>
          <p className="text-muted-foreground">
            Revenue forecasts for {upcomingEvents.length} upcoming events
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/forecasts/calculator">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Calculator className="h-4 w-4" />
              Calculator
            </Button>
          </Link>
          <Card className="px-4 py-2">
            <div className="text-sm text-muted-foreground">Total Forecast</div>
            <div className="text-xl font-bold">{formatCurrency(totalForecast)}</div>
          </Card>
        </div>
      </div>

      <ForecastExplainer />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudSun className="h-5 w-5" />
            Upcoming Event Forecasts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {forecastDetails.length === 0 ? (
            <div className="py-12 text-center space-y-4">
              <CloudSun className="h-12 w-12 mx-auto text-muted-foreground/30" />
              <div>
                <p className="font-medium text-sm">No upcoming booked events</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                  Add a future booking to see a revenue forecast. The more past events you have logged, the more accurate the forecast.
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <a href="/dashboard/events?new=true" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors">
                  Add an event →
                </a>
                <a href="/dashboard/events/import" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  Import CSV
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {forecastDetails.map(({ event, forecast }) => (
                <div
                  key={event.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-lg truncate">
                        {event.event_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(event.event_date)}
                        {event.location && ` at ${event.location}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <ForecastCard event={event} forecast={forecast} />
                    </div>
                  </div>

                  {/* Weather not set nudge — skip for fixed-revenue contracts. */}
                  {!event.event_weather && !isFixedRevenueEvent(event) && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded px-2.5 py-1.5">
                      <CloudSun className="h-3.5 w-3.5 shrink-0" />
                      <span>No weather set — <a href={`/dashboard/events?edit=${event.id}`} className="underline underline-offset-2 hover:text-foreground">add it</a> for a more accurate forecast</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    {event.event_type && (
                      <Badge variant="outline">{event.event_type}</Badge>
                    )}
                    {event.event_weather && (
                      <Badge variant="outline">{event.event_weather}</Badge>
                    )}
                    {!isFixedRevenueEvent(event) && (
                      <WhatIfPanel
                        event={event}
                        currentForecast={forecast?.forecast ?? event.forecast_sales ?? 0}
                        calibratedCoefficients={calibrated}
                        eventTypeAvgs={eventTypeAvgs}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Potential Bookings — unbooked future events with forecasts */}
      {unbookedEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              Potential Bookings
              <span className="text-sm font-normal text-muted-foreground ml-1">
                ({unbookedEvents.length} unconfirmed — click &quot;Book It&quot; in Events to confirm)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="text-right">Forecast</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbookedEvents.map((event) => {
                  const result = calculateForecast(event, events, { calibratedCoefficients: calibrated });
                  return (
                    <TableRow key={event.id} className="opacity-75">
                      <TableCell>
                        <div className="font-medium">{event.event_name}</div>
                        <div className="text-xs text-muted-foreground md:hidden">{formatDate(event.event_date)}</div>
                        {(event.location || event.city) && (
                          <div className="text-xs text-muted-foreground">{event.location ?? event.city}</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {formatDate(event.event_date)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {event.event_type ? (
                          <Badge variant="outline" className="text-xs">{event.event_type}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <ForecastInline event={event} forecast={result} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
