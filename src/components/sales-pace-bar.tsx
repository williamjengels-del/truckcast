import { TrendingUp } from "lucide-react";
import type { SalesComparable } from "@/lib/sales-pace";

interface Props {
  /** Operator's current logged sales for the day-of event. Falls
   *  back to 0 when net_sales is null (sales not yet logged). */
  currentSales: number;
  /** Historical comparable, or null when this is the first time at
   *  the event/venue. */
  comparable: SalesComparable | null;
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Sales pace bar — compares the operator's current logged sales for
 * today's event against a historical average for a comparable event.
 *
 * v1 is intentionally not a true "pace" (no hour-by-hour). VendCast
 * doesn't store hourly POS data per event — net_sales is updated in
 * aggregate as POS sync runs. Showing "$X so far · NN% of $Y avg"
 * gives the operator the same actionable signal: am I tracking
 * ahead, on, or behind a typical day at this event?
 *
 * Empty state: "First time at this event — no comparison yet"
 *   (rendered when comparable is null).
 *
 * No-sales-yet state (currentSales === 0):
 *   shows the comparable as a target without a percentage label.
 */
export function SalesPaceBar({ currentSales, comparable }: Props) {
  if (!comparable) {
    return (
      <div className="flex items-start gap-2 text-sm" data-testid="day-of-event-pace-empty">
        <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          First time at this event — no comparison yet.
        </p>
      </div>
    );
  }

  const target = comparable.avgSales;
  const hasCurrent = currentSales > 0;
  const ratio = target > 0 ? currentSales / target : 0;
  const pct = Math.round(ratio * 100);
  const widthPct = Math.min(100, Math.max(0, ratio * 100));

  const aheadOrBehind =
    pct === 0 ? "" : pct >= 100 ? "ahead of" : pct >= 90 ? "tracking" : "behind";

  return (
    <div className="space-y-1.5" data-testid="day-of-event-pace">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {hasCurrent ? `${formatCurrency(currentSales)} so far` : "Sales not yet logged"}
        </span>
        <span className="text-xs text-muted-foreground">
          {hasCurrent ? `${pct}% ${aheadOrBehind}` : "Target:"} {formatCurrency(target)} avg
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={
            pct >= 100
              ? "h-full bg-green-500 dark:bg-green-400 transition-all"
              : pct >= 90
              ? "h-full bg-orange-500 dark:bg-orange-400 transition-all"
              : "h-full bg-muted-foreground/40 transition-all"
          }
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Comparable: {comparable.label} ({comparable.sampleCount} prior{" "}
        {comparable.sampleCount === 1 ? "event" : "events"})
      </p>
    </div>
  );
}
