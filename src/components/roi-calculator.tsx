"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

// ROI calculator — public homepage tool. Lets prospects answer "would
// VendCast pay for itself for me?" without a signup gate.
//
// Three inputs (all sliders + numeric override):
//   1. Events per month
//   2. Average revenue per event
//   3. % of events where weather is a factor
//
// Outputs:
//   - Annual revenue at stake
//   - Estimated weather-disrupted dollars per year (at our $800/event observed loss)
//   - VendCast price (Pro tier $39/mo = $468/yr) vs single-event-saved comparison
//   - "Pays for itself X times over" framing
//
// Why this exists (per v33 brief #2): the homepage cuts the previous
// "Predict Your Success" callout because it overclaimed. A calculator
// is different — it's an interactive demo that puts dollars from the
// operator's own operation into the conversion math. Defensible because
// the inputs are theirs and the output is a calculated comparison, not
// a marketing claim.

const PRO_MONTHLY = 39;
const PRO_ANNUAL = PRO_MONTHLY * 12;

// Per the homepage weather-loss copy: $800 lost on average per
// weather-disrupted event (ops history, anchored, defensible).
const AVG_WEATHER_LOSS_PER_EVENT = 800;

// Conservative assumption: VendCast catches roughly 1 in 4 weather-
// disrupted events early enough for the operator to act (cancel, pivot,
// reduce prep, etc.). Operator + tool together — not VendCast alone.
const CATCH_RATE = 0.25;

function formatDollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function RoiCalculator() {
  const [eventsPerMonth, setEventsPerMonth] = useState(8);
  const [avgRevenue, setAvgRevenue] = useState(1200);
  const [weatherPct, setWeatherPct] = useState(20);

  const annualEvents = eventsPerMonth * 12;
  const annualRevenue = annualEvents * avgRevenue;
  const weatherEvents = Math.round(annualEvents * (weatherPct / 100));
  const annualWeatherLoss = weatherEvents * AVG_WEATHER_LOSS_PER_EVENT;
  const catchableLoss = Math.round(annualWeatherLoss * CATCH_RATE);

  // Pays-for-itself math: how many catches at $800 per event would cover Pro annual.
  const eventsToBreakEven = Math.ceil(PRO_ANNUAL / AVG_WEATHER_LOSS_PER_EVENT);
  const paybackMultiple =
    catchableLoss > 0 ? Math.round(catchableLoss / PRO_ANNUAL) : 0;

  return (
    <div className="rounded-2xl border border-brand-teal/30 bg-brand-teal/5 p-6 md:p-10">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal mb-2">
          Does VendCast pay for itself for you?
        </p>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Run the math on your operation
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
          Three inputs. The output is your numbers, not ours.
        </p>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Events per month</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="40"
              value={eventsPerMonth}
              onChange={(e) => setEventsPerMonth(parseInt(e.target.value))}
              className="flex-1 accent-brand-teal"
            />
            <input
              type="number"
              min="1"
              max="40"
              value={eventsPerMonth}
              onChange={(e) =>
                setEventsPerMonth(
                  Math.min(40, Math.max(1, parseInt(e.target.value) || 1))
                )
              }
              className="w-16 rounded-md border bg-background px-2 py-1 text-sm tabular-nums text-right"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Average revenue per event</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="100"
              max="5000"
              step="100"
              value={avgRevenue}
              onChange={(e) => setAvgRevenue(parseInt(e.target.value))}
              className="flex-1 accent-brand-teal"
            />
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="number"
                min="100"
                max="20000"
                step="50"
                value={avgRevenue}
                onChange={(e) =>
                  setAvgRevenue(
                    Math.max(0, parseInt(e.target.value) || 0)
                  )
                }
                className="w-20 rounded-md border bg-background px-2 py-1 text-sm tabular-nums text-right"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">% of events affected by weather</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="60"
              value={weatherPct}
              onChange={(e) => setWeatherPct(parseInt(e.target.value))}
              className="flex-1 accent-brand-teal"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                max="100"
                value={weatherPct}
                onChange={(e) =>
                  setWeatherPct(
                    Math.min(100, Math.max(0, parseInt(e.target.value) || 0))
                  )
                }
                className="w-16 rounded-md border bg-background px-2 py-1 text-sm tabular-nums text-right"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Output */}
      <div className="rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-6 md:p-8 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Annual revenue
            </p>
            <p className="text-2xl font-bold tabular-nums">{formatDollars(annualRevenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {annualEvents} events × {formatDollars(avgRevenue)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              At weather risk
            </p>
            <p className="text-2xl font-bold text-brand-orange tabular-nums">
              {formatDollars(annualWeatherLoss)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {weatherEvents} events × $800 avg loss
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Catchable with VendCast
            </p>
            <p className="text-2xl font-bold text-brand-teal tabular-nums">
              {formatDollars(catchableLoss)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ~{Math.round(CATCH_RATE * 100)}% catch rate
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 text-sm">
          <Sparkles className="h-5 w-5 text-brand-orange shrink-0 mt-0.5" />
          <p>
            <span className="font-semibold">VendCast Pro is {formatDollars(PRO_ANNUAL)}/yr.</span>{" "}
            {paybackMultiple > 1 ? (
              <span className="text-muted-foreground">
                Catching just {eventsToBreakEven} weather-disrupted event{eventsToBreakEven === 1 ? "" : "s"} pays for the year — and you&apos;re likely catching closer to <span className="font-semibold text-foreground">{paybackMultiple}× that</span>.
              </span>
            ) : (
              <span className="text-muted-foreground">
                Catching just {eventsToBreakEven} weather-disrupted event{eventsToBreakEven === 1 ? "" : "s"} pays for the year.
              </span>
            )}
          </p>
        </div>
        <Link href="/signup" className="shrink-0">
          <Button size="lg" className="gap-2 whitespace-nowrap">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        $800 weather-loss anchor from real operator data. ~25% catch rate is conservative — operator + VendCast together. Your mileage will vary.
      </p>
    </div>
  );
}
