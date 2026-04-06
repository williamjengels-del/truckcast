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
  BookOpen,
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
  { href: "/dashboard/events", label: "Events", icon: Calendar },
  { href: "/dashboard/forecasts", label: "Forecasts", icon: CloudSun },
  { href: "/dashboard/performance", label: "Performance", icon: BarChart3 },
  { href: "/dashboard/analytics", label: "Analytics", icon: TrendingUp },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
  { href: "/dashboard/bookings", label: "Bookings", icon: BookOpen },
  { href: "/dashboard/contacts", label: "Contacts", icon: Users },
  { href: "/dashboard/followers", label: "Followers", icon: Bell, tier: "premium" },
  { href: "/dashboard/events/import", label: "Import CSV", icon: Upload },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [tier, setTier] = useState<SubscriptionTier | null>(null);
  const [unloggedCount, setUnloggedCount] = useState(0);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, unloggedRes] = await Promise.all([
        supabase.from("profiles").select("subscription_tier").eq("id", user.id).single(),
        supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("booked", true)
          .lt("event_date", new Date().toISOString().split("T")[0])
          .or("net_sales.is.null,net_sales.eq.0"),
      ]);

      if (profileRes.data) setTier(profileRes.data.subscription_tier);
      setUnloggedCount(unloggedRes.count ?? 0);
    }
    load();
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="hidden lg:flex h-screen w-64 flex-col border-r bg-card">
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
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.href === "/dashboard/events" && unloggedCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                    {unloggedCount > 99 ? "99+" : unloggedCount}
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
