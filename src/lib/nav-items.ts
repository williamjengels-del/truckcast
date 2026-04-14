import {
  LayoutDashboard,
  Calendar,
  BarChart3,
  TrendingUp,
  CloudSun,
  Settings,
  Users,
  FileText,
  Upload,
  Bell,
  BookOpen,
  Plug,
  Compass,
} from "lucide-react";
import type { SubscriptionTier } from "@/lib/database.types";

export interface NavItem {
  href: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  tier?: SubscriptionTier;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/events", label: "Events", icon: Calendar },
  { href: "/dashboard/forecasts", label: "Forecasts", icon: CloudSun },
  { href: "/dashboard/performance", label: "Performance", icon: BarChart3 },
  { href: "/dashboard/analytics", label: "Analytics", icon: TrendingUp },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
  { href: "/dashboard/bookings", label: "Bookings", icon: BookOpen },
  { href: "/dashboard/contacts", label: "Contacts", icon: Users },
  { href: "/dashboard/followers", label: "Followers", icon: Bell, tier: "premium" },
  { href: "/dashboard/discover", label: "Discover", icon: Compass, tier: "pro" },
  { href: "/dashboard/events/import", label: "Import CSV", icon: Upload },
  { href: "/dashboard/settings/pos", label: "POS Integrations", icon: Plug },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
