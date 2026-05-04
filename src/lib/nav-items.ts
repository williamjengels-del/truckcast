import {
  LayoutDashboard,
  Calendar,
  Inbox,
  Users,
  Sparkles,
  Plug,
  Settings,
} from "lucide-react";
import type { SubscriptionTier } from "@/lib/database.types";

export interface NavItem {
  href: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  tier?: SubscriptionTier;
}

// 7-item IA post-Phase-4. Inbox consolidates direct booking requests
// + marketplace inquiries as tabs (was two sidebar items, merged
// 2026-05-03 because they're the same triage motion to the operator).
// Insights consolidates Forecasts + Performance + Analytics + Reports
// as tabs; Integrations consolidates POS + CSV Import; Contacts
// consolidates Organizers + Followers.
export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/events", label: "Events", icon: Calendar },
  { href: "/dashboard/contacts", label: "Contacts", icon: Users },
  { href: "/dashboard/insights", label: "Insights", icon: Sparkles },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
