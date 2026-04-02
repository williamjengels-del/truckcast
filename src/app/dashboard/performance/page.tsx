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
import { BarChart3 } from "lucide-react";
import { CONFIDENCE_COLORS, TREND_COLORS } from "@/lib/constants";
import type { EventPerformance } from "@/lib/database.types";

function formatCurrency(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function PerformancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let performances: EventPerformance[] = [];
  if (user) {
    const { data } = await supabase
      .from("event_performance")
      .select("*")
      .eq("user_id", user.id)
      .order("avg_sales", { ascending: false });
    performances = (data ?? []) as EventPerformance[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Event Performance</h1>
        <p className="text-muted-foreground">
          Aggregated stats for your recurring events ({performances.length}{" "}
          events tracked)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Performance Table
          </CardTitle>
        </CardHeader>
        <CardContent>
          {performances.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              Performance data will appear once you have events with sales
              recorded. Add events and enter sales to see stats here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Name</TableHead>
                    <TableHead className="text-center">Times</TableHead>
                    <TableHead className="text-right">Avg Sales</TableHead>
                    <TableHead className="text-right">Median</TableHead>
                    <TableHead className="text-right">Min / Max</TableHead>
                    <TableHead className="text-center">Consistency</TableHead>
                    <TableHead className="text-center">Confidence</TableHead>
                    <TableHead className="text-center">Trend</TableHead>
                    <TableHead className="text-right">Forecast</TableHead>
                    <TableHead>Years</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performances.map((perf) => (
                    <TableRow key={perf.id}>
                      <TableCell className="font-medium">
                        {perf.event_name}
                      </TableCell>
                      <TableCell className="text-center">
                        {perf.times_booked}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(perf.avg_sales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(perf.median_sales)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatCurrency(perf.min_sales)} /{" "}
                        {formatCurrency(perf.max_sales)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`font-mono text-sm ${
                            perf.consistency_score >= 0.7
                              ? "text-green-600"
                              : perf.consistency_score >= 0.5
                                ? "text-yellow-600"
                                : "text-red-600"
                          }`}
                        >
                          {(perf.consistency_score * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="secondary"
                          className={
                            CONFIDENCE_COLORS[perf.confidence] ?? ""
                          }
                        >
                          {perf.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`text-sm font-medium ${
                            TREND_COLORS[perf.trend] ?? ""
                          }`}
                        >
                          {perf.trend}
                        </span>
                        {perf.yoy_growth !== null && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({perf.yoy_growth > 0 ? "+" : ""}
                            {(perf.yoy_growth * 100).toFixed(0)}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(perf.forecast_next)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {perf.years_active ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
