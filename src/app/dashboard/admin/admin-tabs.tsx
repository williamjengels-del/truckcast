"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Tab order is deliberate: Overview first (dashboard-y), then Users
// (what you care about most) + Activity (who did what), then the four
// operational sections. Content + Feedback end because they're touched
// least often.
const TABS = [
  { href: "/dashboard/admin", label: "Overview", exact: true },
  { href: "/dashboard/admin/users", label: "Users" },
  { href: "/dashboard/admin/activity", label: "Activity" },
  { href: "/dashboard/admin/data", label: "Event Data" },
  { href: "/dashboard/admin/beta", label: "Invites" },
  { href: "/dashboard/admin/content", label: "Content" },
  { href: "/dashboard/admin/feedback", label: "Feedback" },
] as const;

/**
 * Active-tab resolution.
 *
 *   exact=true  — pathname must equal href exactly (Overview only —
 *                 otherwise /admin/users would also match Overview via
 *                 startsWith).
 *   exact=false — pathname must start with href (so /admin/users/abc123
 *                 lights up the Users tab, not just /admin/users).
 */
function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b pb-0 -mb-2 flex-wrap">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href, "exact" in tab ? tab.exact : false);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
