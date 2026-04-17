import type { Event } from "@/lib/database.types";
import type { ForecastResult } from "@/lib/forecast-engine";
import {
  computeForecastRange,
  dataDensityFromConfidence,
  dataDensityPill,
  fixedRevenueAmount,
  forecastContextSentence,
  formatDollars,
  formatForecastRange,
  hasUsableForecast,
  isFixedRevenueEvent,
  plainEnglishAdjustments,
} from "@/lib/forecast-display";

interface ForecastCardProps {
  event: Event;
  forecast: ForecastResult | null;
}

export function ForecastCard({ event, forecast }: ForecastCardProps) {
  // Fixed-revenue contract events: no forecast, show contract terms instead.
  // Phase 3 will introduce events.revenue_model and dedicated deposit/balance
  // columns; until then, we render what we have from invoice_revenue.
  if (isFixedRevenueEvent(event)) {
    return <FixedRevenueCard event={event} />;
  }

  // Empty state — no history yet to ground a forecast on. Don't shame the
  // user with a "Learning" label; tell them the next action.
  if (!hasUsableForecast(forecast, event)) {
    return (
      <div className="text-sm text-muted-foreground">
        Not enough history yet — log more events to improve accuracy.
      </div>
    );
  }

  const primary = forecast?.forecast ?? event.forecast_sales ?? 0;
  const confidence = forecast?.confidence ?? event.forecast_confidence ?? null;
  const density = dataDensityFromConfidence(confidence);
  const pill = dataDensityPill(density);

  // Range: prefer live computation when we have a forecast result (so /forecasts
  // stays in sync with events-list without waiting for recalc). Fall back to
  // stored columns. Only suppress when we genuinely lack a confidenceScore AND
  // stored range.
  let low: number | null = null;
  let high: number | null = null;
  if (forecast) {
    const r = computeForecastRange(forecast.forecast, forecast.confidenceScore);
    low = r.low;
    high = r.high;
  } else if (event.forecast_low && event.forecast_high) {
    low = event.forecast_low;
    high = event.forecast_high;
  }

  const context = forecast ? forecastContextSentence(forecast, event) : null;
  const adjustments = forecast ? plainEnglishAdjustments(forecast, event) : [];

  return (
    <div className="space-y-1.5">
      <div className="text-2xl font-bold tabular-nums">
        {formatDollars(primary)} <span className="text-sm font-normal text-muted-foreground">expected</span>
      </div>

      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {low !== null && high !== null && (
          <span>{formatForecastRange(low, high)}</span>
        )}
        {low !== null && high !== null && (
          <span aria-hidden>·</span>
        )}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${pill.className}`}
        >
          {pill.label}
        </span>
      </div>

      {context && (
        <p className="text-sm text-muted-foreground">{context}</p>
      )}

      {forecast && (adjustments.length > 0 || forecast.levelName) && (
        <details className="group mt-2 text-sm">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground transition-colors">
            How is this calculated?
          </summary>
          <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-3 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Method</span>
              <span className="font-medium">{forecast.levelName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Base forecast</span>
              <span className="font-medium tabular-nums">{formatDollars(forecast.baseForecast)}</span>
            </div>
            {adjustments.length > 0 && (
              <div className="pt-1">
                <div className="text-muted-foreground mb-1">Adjustments</div>
                <ul className="space-y-0.5">
                  {adjustments.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {forecast.calibrated && (
              <div className="pt-1 text-muted-foreground">
                Using your personal calibration (coefficients learned from your own event history).
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function FixedRevenueCard({ event }: { event: Event }) {
  const amount = fixedRevenueAmount(event);
  return (
    <div className="space-y-1.5">
      <div className="text-2xl font-bold tabular-nums">
        {formatDollars(amount)} <span className="text-sm font-normal text-muted-foreground">contract</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Flat fee · Catering
      </p>
      {/* TODO(Phase 3): once events.revenue_model, deposit, balance_due, and
          payment_status columns land, render the live payment state here:
          e.g. "Deposit $750 received · Balance $750 due May 5". */}
    </div>
  );
}

// Compact single-line variant for dense tables/lists. Shares terms with the
// full card (same pill labels, same range format) but drops the context
// sentence, disclosure, and primary-value framing.
interface ForecastInlineProps {
  event: Event;
  forecast?: ForecastResult | null;
}

export function ForecastInline({ event, forecast }: ForecastInlineProps) {
  if (isFixedRevenueEvent(event)) {
    const amount = fixedRevenueAmount(event);
    return (
      <div className="leading-tight">
        <div className="tabular-nums">{formatDollars(amount)}</div>
        <div className="text-[10px] text-muted-foreground">contract</div>
      </div>
    );
  }

  if (!hasUsableForecast(forecast ?? null, event)) {
    return <span className="text-muted-foreground">—</span>;
  }

  const confidence = forecast?.confidence ?? event.forecast_confidence ?? null;
  const density = dataDensityFromConfidence(confidence);
  const pill = dataDensityPill(density);

  let low: number | null = null;
  let high: number | null = null;
  if (forecast) {
    const r = computeForecastRange(forecast.forecast, forecast.confidenceScore);
    low = r.low;
    high = r.high;
  } else if (event.forecast_low && event.forecast_high) {
    low = event.forecast_low;
    high = event.forecast_high;
  }

  // L0 cold-start chip: the dense row shows no context sentence, so without
  // this hint users see "Learning" next to a number and wonder where it
  // came from. Only surfaces for true cold-start; blended-L1 rows stay
  // clean (trust gets built on the full card, not in the list).
  const isColdStart = forecast?.level === 0 && (forecast.platformOperatorCount ?? 0) >= 3;

  return (
    <div className="leading-tight space-y-0.5">
      {low !== null && high !== null ? (
        <div className="tabular-nums">
          {formatDollars(low)}–{formatDollars(high)}
        </div>
      ) : (
        <div className="tabular-nums">
          {formatDollars(forecast?.forecast ?? event.forecast_sales ?? 0)}
        </div>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${pill.className}`}
        >
          {pill.label}
        </span>
        {isColdStart && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            from {forecast!.platformOperatorCount} ops
          </span>
        )}
      </div>
    </div>
  );
}
