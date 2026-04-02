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
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      <div className="flex items-center gap-2 px-6 py-5 border-b">
        <TruckIcon className="h-7 w-7 text-primary" />
        <span className="text-xl font-bold">TruckCast</span>
      </div>

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
    </aside>
  );
}
