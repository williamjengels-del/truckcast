"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface Props {
  setupInstantMs: number;
  setupDisplay: string;
}

/**
 * Live countdown to setup time.
 *
 * Server passes a precomputed UTC instant (via wallclockInZoneToUtcMs)
 * — this island just diffs against Date.now() and re-ticks. No
 * timezone math runs on the client; the operator sees their local
 * setup time + a countdown derived from the server-resolved instant.
 *
 * Format progression:
 *   "Setup in 1h 47m"   (>= 60 minutes out)
 *   "Setup in 23m"      (< 60 minutes, > 0)
 *   "Setup time: now"   (within ±60 seconds)
 *   "Setup overdue by 12m" (red, after deadline)
 *
 * Tick cadence: 30 seconds. Minute-level resolution doesn't justify
 * faster, and 30s keeps the sub-minute boundary tight enough for
 * "Setup time: now".
 */
export function SetupCountdown({ setupInstantMs, setupDisplay }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const diffMs = setupInstantMs - now;
  const absMs = Math.abs(diffMs);
  const isOverdue = diffMs < -60_000;
  const isNow = absMs <= 60_000;

  let label: string;
  if (isNow) {
    label = "Setup time: now";
  } else if (isOverdue) {
    const mins = Math.floor(absMs / 60_000);
    if (mins < 60) {
      label = `Setup overdue by ${mins}m`;
    } else {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      label = `Setup overdue by ${h}h ${m}m`;
    }
  } else {
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) {
      label = `Setup in ${mins}m`;
    } else {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      label = `Setup in ${h}h ${m}m`;
    }
  }

  return (
    <div className="flex items-start gap-2 text-sm" data-testid="setup-countdown">
      <Clock
        className={
          isOverdue
            ? "h-4 w-4 text-destructive shrink-0 mt-0.5"
            : isNow
            ? "h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5"
            : "h-4 w-4 text-muted-foreground shrink-0 mt-0.5"
        }
      />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          Setup <span className="text-foreground font-medium">{setupDisplay}</span>
        </p>
        <p
          className={
            isOverdue
              ? "text-sm font-semibold text-destructive"
              : isNow
              ? "text-sm font-semibold text-orange-700 dark:text-orange-400"
              : "text-sm font-medium"
          }
        >
          {label}
        </p>
      </div>
    </div>
  );
}
