"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Circle, X } from "lucide-react";
import type { JourneyContext } from "@/lib/user-journey";

interface SetupProgressProps {
  hasEvents: boolean;
  hasSales: boolean;
  hasPOS: boolean;
  has10Events: boolean;
  journeyContext?: JourneyContext;
}

const STORAGE_KEY = "setup_dismissed";

interface ChecklistItem {
  label: string;
  done: boolean;
  actionLabel?: string;
  actionHref?: string;
  description?: string;
}

export function SetupProgress({
  hasEvents,
  hasSales,
  hasPOS,
  has10Events,
  journeyContext,
}: SetupProgressProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    }
  }, []);

  function handleDismiss() {
    setDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "true");
    }
  }

  const items: ChecklistItem[] = [
    {
      label: "Add your first event",
      done: hasEvents,
      actionLabel: "Add event",
      actionHref: "/dashboard/events?new=true",
    },
    {
      label: "Log sales on a past event",
      done: hasSales,
      actionLabel: "Go to events",
      actionHref: "/dashboard/events",
      description: "Enter actual sales after an event so forecasts improve",
    },
    {
      label: "Connect your POS (optional)",
      done: hasPOS,
      actionLabel: "Connect POS",
      actionHref: "/dashboard/settings",
    },
    {
      label: "Add 10+ events for better forecasts",
      done: has10Events,
      actionLabel: "Import CSV",
      actionHref: "/dashboard/events/import",
    },
    ...(journeyContext !== undefined
      ? [
          {
            label: `Reach 10 events with sales (${Math.min(journeyContext.eventsWithSales, 10)}/10)`,
            done: journeyContext.eventsWithSales >= 10,
            actionLabel: "Log sales",
            actionHref: "/dashboard/events",
            description: "Forecast confidence rises sharply at 10 logged events",
          } satisfies ChecklistItem,
        ]
      : []),
  ];

  const completedCount = items.filter((i) => i.done).length;
  const totalCount = items.length;
  const percentage = Math.round((completedCount / totalCount) * 100);
  const allComplete = completedCount === totalCount;

  // Don't render until mounted (to avoid hydration mismatch from localStorage)
  if (!mounted) return null;

  // Hide if dismissed or all complete
  if (dismissed || allComplete) return null;

  return (
    <Card className="relative border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Getting Started — {percentage}% complete
          </CardTitle>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss setup progress"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-3">
              {item.done ? (
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
              )}
              <div className="flex-1 min-w-0">
                <span
                  className={`text-sm ${item.done ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {item.label}
                </span>
                {!item.done && item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.description}
                  </p>
                )}
              </div>
              {!item.done && item.actionHref && item.actionLabel && (
                <Link
                  href={item.actionHref}
                  className="shrink-0 text-xs text-primary hover:underline font-medium"
                >
                  {item.actionLabel} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
