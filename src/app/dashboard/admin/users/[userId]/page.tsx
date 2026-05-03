import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// buttonVariants imported from the non-client module: this page is a
// server component and cannot import from button.tsx (which is
// "use client"). See src/components/ui/button-variants.ts for detail.
import { buttonVariants } from "@/components/ui/button-variants";
import { ChevronLeft, Upload } from "lucide-react";
import { ImpersonateButton } from "./impersonate-button";
import { ResetTrialButton } from "./reset-trial-button";
import { MfaResetButton } from "./mfa-reset-button";
import { ChatCapOverride } from "./chat-cap-override";
import { EventsAdminTable } from "./events-admin-table";
import type { Event } from "@/lib/database.types";
import { formatDate, formatTimestamp } from "@/lib/format-time";
import {
  chatV2MonthlyCapCents,
  monthToDateCostCents,
} from "@/lib/chat-v2-usage";
import { SUBSCRIPTION_TIER_COLORS } from "@/lib/constants";

// Auth handled by /dashboard/admin/layout.tsx.

interface PageProps {
  params: Promise<{ userId: string }>;
}

// formatDate + formatTimestamp now live in @/lib/format-time and are
// timezone-aware (viewer's browser tz, with the "short" tz abbrev
// included on formatTimestamp). Removed local copies that rendered in
// UTC without tz hint — see commit: "Render admin timestamps in
// viewer timezone via shared helper".

function formatUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Match the summary renderer on /admin/activity so per-user audit rows
// read the same way as the global feed. Keeping a second copy here
// rather than exporting from activity/page.tsx because the two may
// diverge (detail page may want richer formatting per action later).
function renderAuditSummary(row: AdminActionRow): string {
  const m = row.metadata ?? {};
  switch (row.action) {
    case "user.delete":
      return `deleted (${m.email ?? "?"}${m.business_name ? `, ${m.business_name}` : ""})`;
    case "user.tier_change":
      return `tier ${m.from ?? "?"} → ${m.to ?? "?"}`;
    case "user.trial_extend":
      return `+${m.days ?? "?"} days (until ${m.until ?? "?"})`;
    case "user.trial_reset":
      return `trial reset to 14 days`;
    case "user.import_events":
      return `imported ${m.count ?? "?"} events`;
    case "user.impersonate_start":
      return `began impersonating`;
    case "user.impersonate_end":
      return `ended impersonation`;
    case "user.cap_override_set": {
      const fmt = (cents: unknown) =>
        cents === null || cents === undefined
          ? "default"
          : `$${(Number(cents) / 100).toFixed(2)}`;
      return `Tier-B cap ${fmt(m.from)} → ${fmt(m.to)}`;
    }
    default:
      return JSON.stringify(m);
  }
}

interface AdminActionRow {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { userId } = await params;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Single-user detail view — all lookups run in parallel. Event
  // aggregate is computed from a separate small query rather than a
  // SQL sum, because net_sales can be null (unreported events) and we
  // want to show the count of reported events alongside the sum.
  const [profileResult, authResult, recentEventsResult, allEventsResult, auditResult] = await Promise.all([
    service.from("profiles").select("*").eq("id", userId).maybeSingle(),
    service.auth.admin.getUserById(userId),
    // Recent events — scoped to PAST events only (event_date <= today),
    // ordered newest-first. Admin editing is typically after-the-fact
    // corrections + anomaly flagging of historical data, not the
    // upcoming calendar. For "show everything including upcoming," the
    // table's "View all events" link goes to the scoped per-user events
    // page at /admin/users/[userId]/events (Commit C).
    //
    // select("*") — EventForm (reused in the admin edit modal) needs
    // the full ~25-column Event shape as initialData.
    //
    // limit(20) — up from 10. Ops use ("find a specific event to edit")
    // benefits from more rows in the initial view.
    service
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .lte("event_date", new Date().toISOString().slice(0, 10))
      .order("event_date", { ascending: false })
      .limit(20),
    service
      .from("events")
      .select("net_sales, booked")
      .eq("user_id", userId),
    service
      .from("admin_actions")
      .select("id, admin_user_id, action, target_type, target_id, metadata, created_at")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const profile = profileResult.data;
  if (!profile) notFound();

  // Tier-B chat cap override panel context. Read alongside the other
  // queries above; spent is summed via the shared helper so admin and
  // runtime stay aligned. Env default reads from process.env at request
  // time; override comes off the profile we already loaded.
  const chatCapOverrideCents =
    (
      profile as { chat_v2_monthly_cap_cents_override?: number | null }
    ).chat_v2_monthly_cap_cents_override ?? null;
  const chatCapEnvDefaultCents = chatV2MonthlyCapCents(null);
  const chatCapSpentCents = await monthToDateCostCents(service, userId);

  const authUser = authResult.data?.user ?? null;
  const email = authUser?.email ?? null;

  const recentEvents = recentEventsResult.data ?? [];
  const allEvents = allEventsResult.data ?? [];
  const auditRows = (auditResult.data as AdminActionRow[]) ?? [];

  const totalEvents = allEvents.length;
  const bookedEvents = allEvents.filter((e) => e.booked === true).length;
  const reportedSalesEvents = allEvents.filter((e) => e.net_sales != null && e.net_sales > 0);
  const totalRevenue = reportedSalesEvents.reduce((sum, e) => sum + (e.net_sales ?? 0), 0);
  const avgEventRevenue = reportedSalesEvents.length > 0 ? totalRevenue / reportedSalesEvents.length : 0;

  // Resolve admin_user_id -> email for audit rows. Single admin today,
  // but the query is cheap and future-proof.
  const adminIds = Array.from(new Set(auditRows.map((r) => r.admin_user_id)));
  const adminEmailMap: Record<string, string> = {};
  if (adminIds.length > 0) {
    const { data: authList } = await service.auth.admin.listUsers({ perPage: 1000 });
    for (const u of authList?.users ?? []) {
      if (adminIds.includes(u.id)) adminEmailMap[u.id] = u.email ?? "";
    }
  }

  const subscriptionStatus = profile.stripe_subscription_id
    ? "Active subscription"
    : profile.trial_extended_until && new Date(profile.trial_extended_until) > new Date()
    ? `Extended trial (until ${formatDate(profile.trial_extended_until)})`
    : "Standard trial";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/dashboard/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All users
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{profile.business_name ?? "(no business name)"}</h1>
          <p className="text-sm text-muted-foreground">
            {email ?? "(no email)"}
            {profile.city && profile.state ? ` · ${profile.city}, ${profile.state}` : ""}
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-1">{profile.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={SUBSCRIPTION_TIER_COLORS[profile.subscription_tier] ?? SUBSCRIPTION_TIER_COLORS.starter}>
            {profile.subscription_tier}
          </Badge>
          {!profile.onboarding_completed && (
            <Badge variant="outline" className="text-warning border-warning/50">
              Onboarding incomplete
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Total events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalEvents}</p>
            <p className="text-xs text-muted-foreground">{bookedEvents} booked</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Reported revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatUsd(totalRevenue)}</p>
            <p className="text-xs text-muted-foreground">
              across {reportedSalesEvents.length} event{reportedSalesEvents.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Avg event
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatUsd(avgEventRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Data sharing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {profile.data_sharing_enabled ? (
                <span className="text-green-600">On</span>
              ) : (
                <span className="text-muted-foreground">Off</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription & account details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span>{subscriptionStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tier</span>
              <span className="capitalize">{profile.subscription_tier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stripe customer</span>
              <span className="font-mono text-xs">{profile.stripe_customer_id ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stripe subscription</span>
              <span className="font-mono text-xs">{profile.stripe_subscription_id ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trial extended until</span>
              <span>{formatDate(profile.trial_extended_until)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Signed up</span>
              <span>{formatDate(profile.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email confirmed</span>
              <span>
                {authUser?.email_confirmed_at
                  ? formatDate(authUser.email_confirmed_at)
                  : "Not yet"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last sign-in</span>
              <span>
                {authUser?.last_sign_in_at
                  ? formatTimestamp(authUser.last_sign_in_at)
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Onboarding</span>
              <span>{profile.onboarding_completed ? "Complete" : "Incomplete"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions — import + impersonate. Trial reset lands in Commit 6. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 divide-y [&>*]:pt-4 [&>*:first-child]:pt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium text-sm">Import events</div>
              <div className="text-xs text-muted-foreground">
                Upload a CSV on this user&rsquo;s behalf. Same format as self-serve;
                duplicates are skipped by default.
              </div>
            </div>
            <Link
              href={`/dashboard/admin/users/${userId}/import`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import events
            </Link>
          </div>
          <ImpersonateButton
            userId={profile.id}
            targetLabel={profile.business_name ?? email ?? "this user"}
          />
          <ResetTrialButton
            userId={profile.id}
            targetLabel={profile.business_name ?? email ?? "this user"}
            hasSubscription={!!profile.stripe_subscription_id}
            tier={profile.subscription_tier}
            currentExtendedUntil={profile.trial_extended_until}
          />
          <MfaResetButton
            userId={profile.id}
            targetLabel={profile.business_name ?? email ?? "this user"}
          />
          <ChatCapOverride
            userId={profile.id}
            targetLabel={profile.business_name ?? email ?? "this user"}
            currentOverrideCents={chatCapOverrideCents}
            envDefaultCents={chatCapEnvDefaultCents}
            spentCents={chatCapSpentCents}
          />
          <p className="text-xs text-muted-foreground">
            For tier changes and trial extensions by custom day counts, use the
            inline controls on{" "}
            <Link href="/dashboard/admin/users" className="underline">
              the users index
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      {/* Recent events (past, newest first) — Edit + Flag inline per
          row, column-header sort, "View all events" link to the scoped
          per-user events page at /admin/users/[userId]/events. */}
      <Card>
        <CardContent className="p-0">
          <EventsAdminTable
            initialEvents={recentEvents as Event[]}
            profileState={profile.state ?? undefined}
            userId={profile.id}
          />
        </CardContent>
      </Card>

      {/* Admin audit history for this user */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admin actions on this user</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditRows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No admin actions logged for this user.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Admin</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                        <span title={row.created_at}>{formatTimestamp(row.created_at)}</span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {adminEmailMap[row.admin_user_id] ?? row.admin_user_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Badge variant="outline" className="font-mono text-xs">
                          {row.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">{renderAuditSummary(row)}</td>
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
