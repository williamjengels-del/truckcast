"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type InsightsTab = "forecasts" | "performance" | "analytics" | "reports";

const TABS: { key: InsightsTab; label: string }[] = [
  { key: "forecasts", label: "Forecasts" },
  { key: "performance", label: "Performance" },
  { key: "analytics", label: "Analytics" },
  { key: "reports", label: "Reports" },
];

export function InsightsTabBar({ activeTab }: { activeTab: InsightsTab }) {
  return (
    <nav
      aria-label="Insights tabs"
      className="border-b overflow-x-auto"
    >
      <div className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <Link
              key={t.key}
              href={`/dashboard/insights?tab=${t.key}`}
              // Preserve session on tab switch — App Router does a soft navigation.
              scroll={false}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
