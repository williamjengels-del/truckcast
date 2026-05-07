import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import type {
  RecentForecastResult,
  MonthlyAccuracySummary,
} from "@/lib/forecast-vs-actual";

interface DashboardForecastCardProps {
  recent: RecentForecastResult | null;
  monthAccuracy: MonthlyAccuracySummary | null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEventDate(iso: string): string {
  // iso is YYYY-MM-DD. Render as "May 2" — no year so the line stays
  // short. Year is typically self-evident from "this month" framing
  // and from the rest of the dashboard's recency cues.
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const OUTCOME_LABELS = {
  within_range: "within range",
  below_range: "below range",
  above_range: "above range",
} as const;

const OUTCOME_COLORS = {
  within_range: "text-green-600",
  below_range: "text-destructive",
  above_range: "text-brand-teal",
} as const;

/**
 * Dashboard card that surfaces forecast-vs-actual signals — the
 * "aha moment" for the forecasting product. Two parts:
 *
 *   1. Most recent past event with both forecast + actual logged.
 *      Shows the operator the freshest evidence the system works
 *      (or doesn't) right at the top of their dashboard.
 *
 *   2. This-month rolling accuracy stat. Mirrors the homepage's
 *      "4 out of 5 forecasts in range" promise on the operator's
 *      own data.
 *
 * Renders nothing when neither rollup has data — fresh accounts
 * see no card until they've logged at least one sale on a past
 * event with a forecast. Once they have one, the card surfaces
 * and stays.
 *
 * Computed server-side via src/lib/forecast-vs-actual.ts. The
 * range-bounds logic uses explicit forecast_low / forecast_high
 * columns when present (PR #197), falling back to ±20% of the
 * point estimate otherwise — same threshold the cron weekly digest
 * uses, so dashboard + email tell the operator the same story.
 */
export function DashboardForecastCard({
  recent,
  monthAccuracy,
}: DashboardForecastCardProps) {
  if (!recent && !monthAccuracy) return null;

  return (
    <Card data-testid="dashboard-forecast-card">
      <CardContent className="py-5 space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand-teal" />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Your forecasts
          </p>
        </div>

        {recent && (
          <div className="space-y-1" data-testid="dashboard-forecast-recent">
            <p className="text-sm">
              <span className="text-muted-foreground">Most recent: </span>
              <span className="font-medium">{recent.eventName}</span>
              <span className="text-muted-foreground">
                {" "}
                · {formatEventDate(recent.eventDate)}
              </span>
            </p>
            <p className="text-sm">
              <span className="font-semibold">{formatCurrency(recent.actual)} actual</span>
              <span className={`ml-2 ${OUTCOME_COLORS[recent.outcome]}`}>
                · {OUTCOME_LABELS[recent.outcome]}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                ({formatCurrency(recent.forecastLow)}–
                {formatCurrency(recent.forecastHigh)} forecast)
              </span>
            </p>
          </div>
        )}

        {monthAccuracy && monthAccuracy.total > 0 && (
          <div
            className={recent ? "border-t pt-3" : ""}
            data-testid="dashboard-forecast-month"
          >
            <p className="text-sm">
              <span className="font-semibold">
                {monthAccuracy.inRange} of {monthAccuracy.total}{" "}
                forecast{monthAccuracy.total === 1 ? "" : "s"} in range
              </span>
              <span className="text-muted-foreground"> · This month</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
