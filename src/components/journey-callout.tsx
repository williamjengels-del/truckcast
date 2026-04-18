"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JourneyContext, JourneyState } from "@/lib/user-journey";

interface JourneyCalloutProps {
  journeyContext: JourneyContext;
}

// ── State-specific copy ──────────────────────────────────────────────────────

const STATE_CONTENT: Record<
  Exclude<JourneyState, "calibrated">,
  { badge: string; badgeColor: string; headline: string; body: string }
> = {
  new_user: {
    badge: "Getting Started",
    badgeColor:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    headline: "Start with what you know",
    body: "Add your first event — past or upcoming. Every booking you enter helps VendCast learn your business.",
  },
  building: {
    badge: "Building History",
    badgeColor:
      "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    headline: "Build your history",
    body: "Import past events to unlock forecasts. VendCast's engine needs at least 10 events with sales to start calibrating.",
  },
  logging: {
    badge: "Ready to Log",
    badgeColor:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    headline: "Log your sales",
    body: "You have events but many are missing sales data. Log actuals after each event — this is how forecasts get accurate.",
  },
  calibrating: {
    badge: "Calibrating",
    badgeColor:
      "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
    headline: "Forecasts are calibrating",
    body: "You're building real predictive power. Keep logging sales after each event — accuracy improves significantly at 30 logged events.",
  },
};

// Storage key includes state name so it re-shows when state advances.
function storageKey(state: JourneyState) {
  return `journey_callout_dismissed_${state}`;
}

export function JourneyCallout({ journeyContext }: JourneyCalloutProps) {
  const { state, eventsWithSales, totalEvents, nextStep, hasPOS } = journeyContext;
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(localStorage.getItem(storageKey(state)) === "true");
    }
  }, [state]);

  function handleDismiss() {
    setDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey(state), "true");
    }
  }

  // Never show for calibrated users or before hydration or after dismissal.
  if (!mounted || state === "calibrated" || dismissed) return null;

  const content = STATE_CONTENT[state];

  // When in logging/calibrating state without POS, show a nudge to connect POS
  const showPOSNudge = !hasPOS && (state === "logging" || state === "calibrating");

  // Progress indicator — how far toward the 30-event goal.
  const progressLabel =
    state === "new_user"
      ? `0 / 10 events with sales`
      : state === "building"
        ? `${eventsWithSales} / 10 events with sales`
        : state === "logging"
          ? `${eventsWithSales} / ${totalEvents} events have sales`
          : `${eventsWithSales} / 30 events with sales`; // calibrating

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${content.badgeColor}`}
          >
            {content.badge}
          </span>
          <h3 className="text-sm font-semibold">{content.headline}</h3>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Dismiss callout"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <p className="text-sm text-muted-foreground">{content.body}</p>

      {/* POS nudge — shown when not connected and in active logging states */}
      {showPOSNudge && (
        <div className="rounded-md bg-muted/60 px-3 py-2 flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            💡 Connect Square or Toast to log sales automatically
          </span>
          <Link href="/dashboard/integrations?tab=pos" className="font-medium text-primary hover:underline shrink-0">
            Set up POS →
          </Link>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground tabular-nums">
          {progressLabel}
        </span>
        <Link href={nextStep.href}>
          <Button size="sm" className="gap-1.5 text-xs h-8">
            {nextStep.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
