"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type ContactsTab = "organizers" | "followers";

const TABS: { key: ContactsTab; label: string }[] = [
  { key: "organizers", label: "Organizers" },
  { key: "followers", label: "Followers" },
];

export function ContactsTabBar({ activeTab }: { activeTab: ContactsTab }) {
  return (
    <nav aria-label="Contacts tabs" className="border-b overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          const href = t.key === "organizers" ? "/dashboard/contacts" : "/dashboard/contacts?tab=followers";
          return (
            <Link
              key={t.key}
              href={href}
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
