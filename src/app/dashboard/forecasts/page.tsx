import type { Metadata } from "next";
export const metadata: Metadata = { title: "Forecasts" };

import { createClient } from "@/lib/supabase/server";
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
import { TIER_COLORS } from "@/lib/constants";
import type { Event } from "@/lib/database.types";
import { ForecastExplainer } from "./forecast-explainer";
import { WhatIfPanel } from "@/components/what-if-panel";

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

export default async function ForecastsPage() {
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
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {event.event_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(event.event_date)}
                        {event.location && ` at ${event.location}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold">
                        {formatCurrency(
                          forecast?.forecast ?? event.forecast_sales
                        )}
                      </div>
                      {forecast && (
                        <div className="flex flex-col items-end gap-1">
                          <Badge
                            variant="secondary"
                            className={
                              forecast.confidence === "HIGH"
                                ? "bg-green-100 text-green-800"
                                : forecast.confidence === "MEDIUM"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                            }
                          >
                            {forecast.confidence} ({Math.round(forecast.confidenceScore * 100)}%)
                          </Badge>
                          {forecast.calibrated && (
                            <span className="text-xs text-muted-foreground">Calibrated</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {forecast && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Method: </span>
                        <span className="font-medium">
                          L{forecast.level} — {forecast.levelName}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Data points:{" "}
                        </span>
                        <span className="font-medium">
                          {forecast.dataPoints}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Base: </span>
                        <span className="font-medium">
                          {formatCurrency(forecast.baseForecast)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Signal: </span>
                        <span className="font-medium">{forecast.signal}</span>
                      </div>
                      {forecast.weatherCoefficient &&
                        forecast.weatherCoefficient !== 1 && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground">
                              Weather adj:{" "}
                            </span>
                            <span className="font-medium">
                              {event.event_weather} (
                              {forecast.weatherCoefficient}x ={" "}
                              {formatCurrency(forecast.weatherAdjustment)})
                            </span>
                          </div>
                        )}
                      {forecast.dayOfWeekCoefficient &&
                        forecast.dayOfWeekCoefficient !== 1 && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground">
                              Day adj:{" "}
                            </span>
                            <span className="font-medium">
                              {forecast.dayOfWeekCoefficient}x ={" "}
                              {formatCurrency(forecast.dayOfWeekAdjustment)}
                            </span>
                          </div>
                        )}
                      {forecast.venueFamiliarityApplied && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">
                            Venue familiarity:{" "}
                          </span>
                          <span className="font-medium text-green-700">
                            Applied (prior history at this location)
                          </span>
                        </div>
                      )}
                      {forecast.platformOperatorCount != null &&
                        forecast.platformOperatorCount >= 2 && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground">
                              Platform benchmark:{" "}
                            </span>
                            <span className="font-medium text-blue-700 dark:text-blue-400">
                              {forecast.platformOperatorCount} operators, median{" "}
                              {formatCurrency(forecast.platformMedianSales ?? null)}
                              {forecast.level === 0 ? " (base)" : " (blended)"}
                            </span>
                          </div>
                        )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    {event.event_tier && (
                      <Badge
                        variant="outline"
                        className={TIER_COLORS[event.event_tier] ?? ""}
                      >
                        Tier {event.event_tier}
                      </Badge>
                    )}
                    {event.event_type && (
                      <Badge variant="outline">{event.event_type}</Badge>
                    )}
                    {event.event_weather && (
                      <Badge variant="outline">{event.event_weather}</Badge>
                    )}
                    <WhatIfPanel
                      event={event}
                      currentForecast={forecast?.forecast ?? event.forecast_sales ?? 0}
                      calibratedCoefficients={calibrated}
                      eventTypeAvgs={eventTypeAvgs}
                    />
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
                  <TableHead className="text-right hidden sm:table-cell">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbookedEvents.map((event) => {
                  const result = calculateForecast(event, events, { calibratedCoefficients: calibrated });
                  const forecastVal = result?.forecast ?? event.forecast_sales;
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
                        {formatCurrency(forecastVal)}
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell">
                        {result ? (
                          <Badge
                            variant="secondary"
                            className={
                              result.confidence === "HIGH"
                                ? "bg-green-100 text-green-800 text-xs"
                                : result.confidence === "MEDIUM"
                                  ? "bg-yellow-100 text-yellow-800 text-xs"
                                  : "bg-red-100 text-red-800 text-xs"
                            }
                          >
                            {result.confidence}
                          </Badge>
                        ) : "—"}
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
