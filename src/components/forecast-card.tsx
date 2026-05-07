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

  // v2 stored values take precedence when available — the Bayesian
  // posterior produces an honest 50% credible interval ("most likely")
  // alongside the 80% interval ("could swing"). Showing both gives
  // the operator an actionable inner band while still surfacing the
  // wider tail. Fall back to v1's single-range UX when v2 hasn't
  // populated for the row yet (operator will see the legacy framing
  // until the next recalc cycle fills the shadow columns).
  const hasV2 =
    event.forecast_bayesian_point != null &&
    event.forecast_bayesian_low_80 != null &&
    event.forecast_bayesian_high_80 != null;

  // Cold-start: v2 fired but with zero personal observations of this
  // event_name. Posterior collapses to the operator-overall prior,
  // which gives a wide interval that LOOKS like a forecast but
  // isn't really informative — the model has no history to ground
  // on. Show explicit "first time" copy instead of pretending the
  // 50% interval is actionable. Operator request 2026-05-07 after
  // seeing $339-$1,172 displayed for a brand-new event.
  const isColdStart =
    hasV2 && (event.forecast_bayesian_n_obs ?? 0) === 0;

  const primary = hasV2
    ? event.forecast_bayesian_point!
    : (forecast?.forecast ?? event.forecast_sales ?? 0);
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

  // Inner range = "most likely" — narrower band, the actionable
  // number for staffing/inventory. From v2's 50% credible interval
  // when stored, otherwise null (v1 fallback shows only one range).
  // Outer range = "could swing" — wider band acknowledging the tail.
  // From v2's 80% credible interval when stored, otherwise from v1's
  // band (the only range v1 produced).
  let innerLow: number | null = null;
  let innerHigh: number | null = null;
  let outerLow: number | null = null;
  let outerHigh: number | null = null;
  if (hasV2) {
    if (event.forecast_bayesian_low_50 != null && event.forecast_bayesian_high_50 != null) {
      innerLow = event.forecast_bayesian_low_50;
      innerHigh = event.forecast_bayesian_high_50;
    }
    outerLow = event.forecast_bayesian_low_80!;
    outerHigh = event.forecast_bayesian_high_80!;
  } else if (forecast) {
    const r = computeForecastRange(forecast.forecast, forecast.confidenceScore);
    outerLow = r.low;
    outerHigh = r.high;
  } else if (event.forecast_low && event.forecast_high) {
    outerLow = event.forecast_low;
    outerHigh = event.forecast_high;
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

      {/* Cold-start treatment — n_obs = 0 means the engine has no
          history for this event_name and the wide interval reflects
          "I have no idea" rather than a calibrated guess. Tell the
          operator that explicitly instead of dressing it up as a
          50% interval they can act on. */}
      {isColdStart ? (
        <>
          <p className="text-sm text-muted-foreground">
            First time at this event — no history to ground a forecast yet.
          </p>
          {outerLow !== null && outerHigh !== null && (
            <p className="text-xs text-muted-foreground">
              Wide range based on your overall average: {formatDollars(outerLow)}–{formatDollars(outerHigh)}
            </p>
          )}
        </>
      ) : (
        <>
          {/* Inner range = "most likely" (50% credible interval, v2 only).
              Tighter band, the actionable number for staffing/inventory.
              When inner is unavailable (legacy v1 row, no v2 stored values),
              we fall back to showing only the outer range as before. */}
          {innerLow !== null && innerHigh !== null && (
            <div className="text-sm text-muted-foreground">
              Most likely{" "}
              <span className="font-medium text-foreground">
                {formatDollars(innerLow)}–{formatDollars(innerHigh)}
              </span>
            </div>
          )}

          {/* Outer range = "could swing" (80% interval for v2, full range
              for v1). Surfaces the wider tail without making it the
              headline. When inner range is shown, this reads as
              secondary; when inner is null (v1 fallback), this is the
              primary range and uses the legacy "Likely $X-$Y" format. */}
          {outerLow !== null && outerHigh !== null && (
            <div className="text-xs text-muted-foreground">
              {innerLow !== null && innerHigh !== null
                ? <>Could swing {formatDollars(outerLow)}–{formatDollars(outerHigh)}</>
                : formatForecastRange(outerLow, outerHigh)}
            </div>
          )}
        </>
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

  // Inline variant prefers the v2 50% interval for the dense range.
  // The 80% interval would be too wide to read at a glance in a dense
  // table; the 50% gives a tight actionable number with the same
  // honesty story as the full card. Falls back to v1's range when
  // v2 isn't stored for the row.
  let low: number | null = null;
  let high: number | null = null;
  const hasV2Inline =
    event.forecast_bayesian_low_50 != null && event.forecast_bayesian_high_50 != null;
  if (hasV2Inline) {
    low = event.forecast_bayesian_low_50!;
    high = event.forecast_bayesian_high_50!;
  } else if (forecast) {
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
          {formatDollars(
            event.forecast_bayesian_point ?? forecast?.forecast ?? event.forecast_sales ?? 0
          )}
        </div>
      )}
    </div>
  );
}
