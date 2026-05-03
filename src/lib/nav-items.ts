import {
  LayoutDashboard,
  Calendar,
  Inbox,
  Megaphone,
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

// 7-item IA post-Phase-4. Insights consolidates Forecasts + Performance +
// Analytics + Reports as tabs; Integrations consolidates POS + CSV Import;
// Contacts consolidates Organizers + Followers.
export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/bookings", label: "Inbox", icon: Inbox },
  // Phase 7 marketplace inquiry inbox — separate from /bookings (which
  // is the 1:1 direct-to-operator booking flow). Inquiries here are
  // routed to multiple operators via city + event_type matching.
  { href: "/dashboard/inquiries", label: "Inquiries", icon: Megaphone },
  { href: "/dashboard/events", label: "Events", icon: Calendar },
  { href: "/dashboard/contacts", label: "Contacts", icon: Users },
  { href: "/dashboard/insights", label: "Insights", icon: Sparkles },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
