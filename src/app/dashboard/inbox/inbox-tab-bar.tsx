"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useImpersonation } from "@/components/impersonation-context";
import { cn } from "@/lib/utils";

// Tabs for the unified Inbox section. The two surfaces have different
// data models (BookingRequest vs event_inquiries) but operators
// experience them the same way ("an organizer wants to book me"), so
// they sit under one nav entry.
//
// Direct = 1:1 booking requests submitted via the operator's own
// public booking link (vendcast.co/<slug>).
// Marketplace = Phase 7 inquiries routed to multiple operators via
// city + event_type matching.
//
// Badge logic: each tab shows its own pending count when non-zero so
// the operator knows where the new things are. Reads through
// /api/dashboard/sidebar-state which already aggregates both.

const TABS = [
  { href: "/dashboard/inbox/direct", label: "Direct bookings" },
  { href: "/dashboard/inbox/marketplace", label: "Marketplace inquiries" },
] as const;

export function InboxTabBar() {
  const pathname = usePathname();
  const { effectiveUserId } = useImpersonation();
  const [openInquiryCount, setOpenInquiryCount] = useState(0);

  // Refetch counts on mount + on impersonation flip + on the
  // vendcast:sidebar-stale custom event (dispatched by inbox actions
  // so the badge updates without a full reload).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/dashboard/sidebar-state");
        if (!res.ok) return;
        const data = (await res.json()) as { open_inquiry_count?: number };
        if (!cancelled) setOpenInquiryCount(data.open_inquiry_count ?? 0);
      } catch {
        // Non-fatal — tab bar still renders, just without badges.
      }
    }
    load();
    const handler = () => load();
    window.addEventListener("vendcast:sidebar-stale", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("vendcast:sidebar-stale", handler);
    };
  }, [effectiveUserId]);

  return (
    <nav aria-label="Inbox tabs" className="border-b overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const isActive = pathname.startsWith(t.href);
          const count =
            t.href === "/dashboard/inbox/marketplace" ? openInquiryCount : 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              scroll={false}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-2",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <span>{t.label}</span>
              {count > 0 && (
                <span className="rounded-full bg-brand-orange text-white text-[10px] font-semibold px-1.5 py-0.5 tabular-nums">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
