import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/admin";

const adminNavItems = [
  { href: "/dashboard/admin", label: "Overview" },
  { href: "/dashboard/admin/users", label: "Users" },
  { href: "/dashboard/admin/data", label: "Event Data" },
  { href: "/dashboard/admin/beta", label: "Invites" },
  { href: "/dashboard/admin/feedback", label: "Feedback" },
  { href: "/dashboard/admin/content", label: "Content" },
  { href: "/dashboard/admin/activity", label: "Activity", active: true },
];

interface AdminActionRow {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

const PAGE_SIZE = 100;

/**
 * Compact per-action summary renderer. Keep each case one line. When
 * metadata shape changes, add a case here rather than sprinkling format
 * logic across the table.
 */
function renderSummary(row: AdminActionRow): string {
  const m = row.metadata ?? {};
  switch (row.action) {
    case "user.delete":
      return `deleted ${m.email ?? row.target_id ?? "user"}${m.business_name ? ` (${m.business_name})` : ""}`;
    case "user.tier_change":
      return `${m.from ?? "?"} → ${m.to ?? "?"}`;
    case "user.trial_extend":
      return `+${m.days ?? "?"} days (until ${m.until ?? "?"})`;
    case "user.trial_reset":
      return `reset to 14-day trial`;
    case "user.import_events":
      return `${m.count ?? "?"} events imported`;
    case "user.impersonate_start":
      return `began impersonating ${m.email ?? row.target_id}`;
    case "user.impersonate_end":
      return `ended impersonation`;
    case "testimonial.create":
      return `"${m.author_name ?? "?"}" (${m.rating ?? "?"}★)`;
    case "testimonial.update": {
      const fields = Array.isArray(m.changes) ? (m.changes as string[]).join(", ") : "—";
      return `updated: ${fields}`;
    }
    case "testimonial.delete":
      return `deleted "${m.author_name ?? row.target_id}"`;
    case "invite.generate":
      return `${m.count ?? "?"} code${m.count === 1 ? "" : "s"} (${m.tier ?? "?"}, ${m.trial_days ?? "?"}d)`;
    case "feedback.delete":
      return `deleted feedback ${row.target_id?.slice(0, 8) ?? "?"}`;
    case "self.account_reset":
      return `wiped own account data`;
    default:
      return JSON.stringify(m);
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminActivityPage() {
  await requireAdmin();

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: actions, error } = await service
    .from("admin_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  // Resolve admin emails — we store user_id on the row (stable), but
  // humans want to see the email in the UI.
  const adminIds = Array.from(new Set((actions ?? []).map((a) => a.admin_user_id)));
  const emailMap: Record<string, string> = {};
  if (adminIds.length > 0) {
    const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
    for (const u of authData?.users ?? []) {
      if (adminIds.includes(u.id)) emailMap[u.id] = u.email ?? "";
    }
  }

  const rows = (actions as AdminActionRow[]) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Activity</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length === PAGE_SIZE
            ? `Last ${PAGE_SIZE} actions`
            : `${rows.length} action${rows.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="flex gap-1 border-b pb-0 -mb-2 flex-wrap">
        {adminNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              item.active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">
              Error loading activity: {error.message}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent actions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No admin actions logged yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Admin</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Summary</th>
                    <th className="px-4 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                        <span title={row.created_at}>
                          {formatTimestamp(row.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {emailMap[row.admin_user_id] ?? row.admin_user_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Badge variant="outline" className="font-mono text-xs">
                          {row.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">{renderSummary(row)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground font-mono text-xs">
                        {row.ip_address ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
