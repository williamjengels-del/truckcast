"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useImpersonation } from "@/components/impersonation-context";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navItems } from "@/lib/nav-items";
import type { SubscriptionTier } from "@/lib/database.types";

// Reads flow through /api/dashboard/sidebar-state (Commit 5c-iv) so
// the sidebar automatically shows the target's state during admin
// impersonation. Sign-out still uses the direct Supabase client —
// it's an auth operation, not a table mutation, and it should always
// sign out the REAL session (the admin), never the impersonation
// target.

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  // Subscribe to impersonation context so we re-fetch sidebar state
  // when the admin starts/stops a session. effectiveUserId flips on
  // any scope change and is the precise signal to re-run the load.
  const { effectiveUserId } = useImpersonation();
  const [tier, setTier] = useState<SubscriptionTier | null>(null);
  const [unloggedCount, setUnloggedCount] = useState(0);
  const [openInquiryCount, setOpenInquiryCount] = useState(0);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/dashboard/sidebar-state");
        if (!res.ok) return;
        const data = (await res.json()) as {
          subscription_tier: SubscriptionTier;
          is_manager: boolean;
          unlogged_count: number;
          open_inquiry_count?: number;
        };
        setTier(data.subscription_tier);
        setIsManager(data.is_manager);
        setUnloggedCount(data.unlogged_count);
        setOpenInquiryCount(data.open_inquiry_count ?? 0);
      } catch {
        // Non-fatal — sidebar renders with default state. A real
        // network outage surfaces elsewhere in the UI.
      }
    }
    load();
  }, [effectiveUserId]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="hidden lg:flex h-screen w-64 flex-col border-r bg-card">
      {/* Brand mark — matches every public surface (login, signup,
          marketing pages). Replaces the previous TruckIcon + wordmark
          combo. */}
      <div className="flex items-center px-6 py-5 border-b">
        <Image
          src="/vendcast-logo.jpg"
          alt="VendCast"
          width={400}
          height={140}
          priority
          className="h-8 w-auto"
        />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter((item) => {
            if (isManager) return ["/dashboard", "/dashboard/events", "/dashboard/settings"].includes(item.href);
            return !item.tier || item.tier === tier;
          })
          .map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.href === "/dashboard/events" && unloggedCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10px] font-bold text-white">
                    {unloggedCount > 99 ? "99+" : unloggedCount}
                  </span>
                )}
                {item.href === "/dashboard/inquiries" && openInquiryCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10px] font-bold text-white">
                    {openInquiryCount > 99 ? "99+" : openInquiryCount}
                  </span>
                )}
              </Link>
            );
          })}
      </nav>

      <div className="border-t p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
