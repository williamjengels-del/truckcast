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
import { CloudSun } from "lucide-react";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import { TIER_COLORS, WEATHER_COEFFICIENTS } from "@/lib/constants";
import type { Event } from "@/lib/database.types";

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

  // Calibrate per-user coefficients
  const calibrated = calibrateCoefficients(events);

  // Calculate forecasts with details
  const forecastDetails = upcomingEvents.map((event) => {
    const result = calculateForecast(event, events, { calibratedCoefficients: calibrated });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Forecasts</h1>
          <p className="text-muted-foreground">
            Revenue forecasts for {upcomingEvents.length} upcoming events
          </p>
        </div>
        <Card className="px-4 py-2">
          <div className="text-sm text-muted-foreground">Total Forecast</div>
          <div className="text-xl font-bold">{formatCurrency(totalForecast)}</div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudSun className="h-5 w-5" />
            Upcoming Event Forecasts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {forecastDetails.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              No upcoming booked events. Add future events to see forecasts.
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
                    </div>
                  )}

                  <div className="flex gap-2">
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
