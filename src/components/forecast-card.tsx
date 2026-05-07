import type { Event } from "@/lib/database.types";
import type { ForecastResult } from "@/lib/forecast-engine";
import {
  computeForecastRange,
  dataDensityFromConfidence,
  fixedRevenueAmount,
  forecastContextSentence,
  formatDollars,
  formatForecastRange,
  hasUsableForecast,
  isFixedRevenueEvent,
  lowConfidenceAnchorSentence,
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

  // Insufficient-data floor — engine produced a number it doesn't believe
  // (final forecast under 10% of the operator's overall median; see
  // INSUFFICIENT_DATA_FLOOR_RATIO in forecast-engine.ts). Suppress the
  // bogus tail number entirely and tell the operator what would help.
  // Live engine result is the source of truth here; on past events
  // recalc clears the stored columns so this branch isn't reached
  // through the stored fallback.
  if (forecast?.insufficientData) {
    return (
      <div className="space-y-1.5 text-sm text-muted-foreground">
        <p>Not enough history on this event yet to forecast.</p>
        <p className="text-xs">
          Log a few more bookings of {event.event_name ? `"${event.event_name}"` : "this event"} and we&rsquo;ll have a number for you.
        </p>
      </div>
    );
  }

  const primary = forecast?.forecast ?? event.forecast_sales ?? 0;
  const confidence = forecast?.confidence ?? event.forecast_confidence ?? null;
  // Per 2026-04-29 operator decision (Julian): drop ALL three confidence
  // pills (Calibrated / Building / Learning) for now. No badge ever — the
  // engine's confidence framing isn't well-calibrated yet, so showing
  // operators a categorical label that can be wrong does more harm than
  // good. Density is still computed because the anchor sentence on
  // low-confidence forecasts uses it. dataDensityPill() helper is kept
  // in forecast-display.ts (unused here today) for future re-render
  // when calibration improves.
  const density = dataDensityFromConfidence(confidence);

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

  // Low-confidence anchor sentence — softer landing for thin-data forecasts.
  // Renders below the range; the standard `forecastContextSentence` is hidden
  // in the learning case to avoid stacking two history-grounded sentences.
  const anchor =
    forecast && density === "learning"
      ? lowConfidenceAnchorSentence(forecast, event)
      : null;
  const context =
    forecast && density !== "learning"
      ? forecastContextSentence(forecast, event)
      : null;
  const adjustments = forecast ? plainEnglishAdjustments(forecast, event) : [];

  return (
    <div className="space-y-1.5">
      <div className="text-2xl font-bold tabular-nums">
        {formatDollars(primary)} <span className="text-sm font-normal text-muted-foreground">expected</span>
      </div>

      {low !== null && high !== null && (
        <div className="text-sm text-muted-foreground">
          {formatForecastRange(low, high)}
        </div>
      )}

      {anchor && (
        <p className="text-sm text-muted-foreground">{anchor}</p>
      )}

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
    </div>
  );
}

// Compact single-line variant for dense tables/lists. Shares the range
// format with the full card; drops the context sentence, disclosure, and
// primary-value framing. With confidence pills dropped fleet-wide
// (2026-04-29), the inline view is now just the range.
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

  // Insufficient-data floor: render an em-dash with a tooltip rather
  // than the bogus tail number. Mirrors ForecastCard's full treatment.
  if (forecast?.insufficientData) {
    return (
      <span
        className="text-muted-foreground"
        title="Not enough history on this event yet to forecast"
      >
        —
      </span>
    );
  }

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

  return (
    <div className="leading-tight">
      {low !== null && high !== null ? (
        <div className="tabular-nums">
          {formatDollars(low)}–{formatDollars(high)}
        </div>
      ) : (
        <div className="tabular-nums">
          {formatDollars(forecast?.forecast ?? event.forecast_sales ?? 0)}
        </div>
      )}
    </div>
  );
}
