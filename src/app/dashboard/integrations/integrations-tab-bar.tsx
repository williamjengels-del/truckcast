"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type IntegrationsTab = "pos" | "csv-import";

const TABS: { key: IntegrationsTab; label: string }[] = [
  { key: "pos", label: "POS Integrations" },
  { key: "csv-import", label: "CSV Import" },
];

export function IntegrationsTabBar({ activeTab }: { activeTab: IntegrationsTab }) {
  return (
    <nav aria-label="Integrations tabs" className="border-b overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <Link
              key={t.key}
              href={`/dashboard/integrations?tab=${t.key}`}
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
