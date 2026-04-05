"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Calendar,
  BarChart3,
  TrendingUp,
  CloudSun,
  Settings,
  LogOut,
  TruckIcon,
  Users,
  FileText,
  Upload,
  Bell,
  Menu,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { SubscriptionTier } from "@/lib/database.types";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  tier?: SubscriptionTier;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/analytics", label: "Analytics", icon: TrendingUp, tier: "premium" },
  { href: "/dashboard/events", label: "Events", icon: Calendar },
  { href: "/dashboard/performance", label: "Performance", icon: BarChart3 },
  { href: "/dashboard/forecasts", label: "Forecasts", icon: CloudSun },
  { href: "/dashboard/events/import", label: "Import CSV", icon: Upload },
  { href: "/dashboard/contacts", label: "Contacts", icon: Users },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
  { href: "/dashboard/followers", label: "Followers", icon: Bell, tier: "premium" },
  { href: "/dashboard/bookings", label: "Bookings", icon: BookOpen },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [tier, setTier] = useState<SubscriptionTier | null>(null);

  useEffect(() => {
    async function loadTier() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("subscription_tier")
          .eq("id", user.id)
          .single();
        if (data) setTier(data.subscription_tier);
      }
    }
    loadTier();
  }, [supabase]);

  // Close sheet when route changes
  useEffect(() => {
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
        className="lg:hidden inline-flex items-center justify-center rounded-lg h-8 w-8 hover:bg-muted transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-64 p-0">
        <SheetHeader className="flex flex-row items-center gap-2 px-6 py-5 border-b">
          <TruckIcon className="h-7 w-7 text-primary" />
          <SheetTitle className="text-xl font-bold">TruckCast</SheetTitle>
        </SheetHeader>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems
            .filter((item) => !item.tier || item.tier === tier)
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
                  <item.icon className="h-4 w-4" />
                  {item.label}
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
