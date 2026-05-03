"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useImpersonation } from "@/components/impersonation-context";
import { cn } from "@/lib/utils";
import { LogOut, TruckIcon, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { navItems } from "@/lib/nav-items";
import type { SubscriptionTier } from "@/lib/database.types";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  // See sidebar.tsx — effectiveUserId is the re-fetch trigger on
  // impersonation state flips.
  const { effectiveUserId } = useImpersonation();
  const [tier, setTier] = useState<SubscriptionTier | null>(null);
  const [unloggedCount, setUnloggedCount] = useState(0);
  const [openInquiryCount, setOpenInquiryCount] = useState(0);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    // Reads via /api/dashboard/sidebar-state — same endpoint the desktop
    // sidebar uses. Impersonation-aware server-side.
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
        // Non-fatal
      }
    }
    load();

    // See sidebar.tsx — same custom-event refresh pattern so badges
    // stay in sync after in-page mutations (inquiry action, event log,
    // etc.) without forcing a full reload.
    const handler = () => {
      load();
    };
    window.addEventListener("vendcast:sidebar-stale", handler);
    return () => {
      window.removeEventListener("vendcast:sidebar-stale", handler);
    };
  }, [effectiveUserId]);

  // Close sheet when route changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    setOpen(false);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="lg:hidden inline-flex items-center justify-center rounded-lg h-11 w-11 hover:bg-muted transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-64 p-0">
        <SheetHeader className="flex flex-row items-center gap-2 px-6 py-5 border-b">
          <TruckIcon className="h-7 w-7 text-primary" />
          <SheetTitle className="text-xl font-bold">VendCast</SheetTitle>
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
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
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                      {unloggedCount > 99 ? "99+" : unloggedCount}
                    </span>
                  )}
                  {item.href === "/dashboard/inquiries" && openInquiryCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
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
      </SheetContent>
    </Sheet>
  );
}
