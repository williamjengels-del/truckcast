import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAdminUser } from "@/lib/admin";

interface RecentProfile {
  id: string;
  business_name: string | null;
  city: string | null;
  subscription_tier: string;
  created_at: string;
}

export default async function AdminOverviewPage() {
  // Layout's requireAdmin() already gated this route, so getAdminUser()
  // is guaranteed non-null. The `!` narrows the type for TS.
  const user = (await getAdminUser())!;

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch quick stats in parallel
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString();

  // Check if cost migration has been applied (events.food_cost column exists)
  let costMigrationApplied = false;
  try {
    const { error: costCheckError } = await serviceClient
      .from("events")
      .select("food_cost")
      .limit(1);
    costMigrationApplied = !costCheckError;
  } catch {
    costMigrationApplied = false;
  }

  const [
    { count: totalUsers },
    { data: recentProfiles },
    { count: totalEvents },
    { count: activeThisWeek },
    { data: allProfiles },
    { data: invites },
  ] = await Promise.all([
    serviceClient.from("profiles").select("*", { count: "exact", head: true }),
    serviceClient
      .from("profiles")
      .select("id, business_name, city, subscription_tier, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    serviceClient.from("events").select("*", { count: "exact", head: true }),
    serviceClient
      .from("events")
      .select("user_id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgoStr),
    serviceClient
      .from("profiles")
      .select("data_sharing_enabled"),
    serviceClient
      .from("beta_invites")
      .select("id, redeemed_by"),
  ]);

  const sharingEnabled = (allProfiles ?? []).filter(
    (p: { data_sharing_enabled: boolean }) => p.data_sharing_enabled
  ).length;
  const sharingDisabled = (totalUsers ?? 0) - sharingEnabled;

  const totalInvites = (invites ?? []).length;
  const redeemedInvites = (invites ?? []).filter(
    (i: { redeemed_by: string | null }) => i.redeemed_by
  ).length;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Check if Stripe is in test mode (key starts with "sk_test_")
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const isStripeTestMode = stripeKey.startsWith("sk_test_");
  const STRIPE_LIVE_DEADLINE = new Date("2026-04-22T00:00:00Z");
  const now = new Date();
  const daysToDeadline = Math.ceil((STRIPE_LIVE_DEADLINE.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const deadlinePassed = now >= STRIPE_LIVE_DEADLINE;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">VendCast Admin</h1>
          <p className="text-sm text-muted-foreground">
            {today} &middot; {user.email}
          </p>
        </div>
      </div>

      {/* Stripe live mode deadline banner */}
      {isStripeTestMode && (
        <div className={`rounded-lg border p-4 ${deadlinePassed ? "bg-red-50 border-red-300 dark:bg-red-950/20 dark:border-red-800" : "bg-amber-50 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800"}`}>
          <div className="flex items-start gap-3">
            <span className="text-xl">{deadlinePassed ? "🚨" : "⚠️"}</span>
            <div>
              <p className={`font-semibold text-sm ${deadlinePassed ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
                {deadlinePassed
                  ? "Stripe is still in TEST MODE — first trials have expired. Users cannot pay."
                  : `Stripe is in TEST MODE — switch to live keys before April 22 (${daysToDeadline} day${daysToDeadline !== 1 ? "s" : ""} left)`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Go to Vercel → truckcast → Settings → Environment Variables → update <code className="font-mono bg-muted px-1 rounded">STRIPE_SECRET_KEY</code>, <code className="font-mono bg-muted px-1 rounded">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>, and <code className="font-mono bg-muted px-1 rounded">STRIPE_WEBHOOK_SECRET</code> with live mode values. Redeploy after saving.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cost tracking migration reminder — disappears once migration is applied */}
      {!costMigrationApplied && (
        <div className="rounded-lg border p-4 bg-blue-50 border-blue-300 dark:bg-blue-950/20 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <span className="text-xl">🗄️</span>
            <div>
              <p className="font-semibold text-sm text-blue-800 dark:text-blue-300">
                Supabase migration needed: cost tracking columns
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Run <code className="font-mono bg-muted px-1 rounded">20260409000004_add_event_costs.sql</code> in the Supabase SQL editor to enable food cost, labor cost, and profit tracking. Until then, cost fields entered in event forms will not save.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                SQL: <code className="font-mono bg-muted px-1 rounded text-xs">ALTER TABLE events ADD COLUMN IF NOT EXISTS food_cost numeric(10,2), ADD COLUMN IF NOT EXISTS labor_cost numeric(10,2), ADD COLUMN IF NOT EXISTS other_costs numeric(10,2);</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Total Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalUsers ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Active This Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{activeThisWeek ?? 0}</p>
            <p className="text-xs text-muted-foreground">events created</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Total Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{(totalEvents ?? 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Data Sharing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{sharingEnabled}</p>
            <p className="text-xs text-muted-foreground">{sharingDisabled} opted out</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground uppercase tracking-wide">
              Beta Codes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{redeemedInvites}</p>
            <p className="text-xs text-muted-foreground">of {totalInvites} redeemed</p>
          </CardContent>
        </Card>
      </div>

      {/* Nav cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { href: "/dashboard/admin/users", label: "User Management", description: "View users, adjust subscription tiers" },
          { href: "/dashboard/admin/data", label: "Event Data", description: "Browse all events across users" },
          { href: "/dashboard/admin/beta", label: "Beta Invites", description: "Generate and manage invite codes" },
          { href: "/dashboard/admin/feedback", label: "Feedback", description: "Read and delete user feedback" },
          { href: "/dashboard/admin/content", label: "Site Content", description: "Manage testimonials and stats" },
        ].map((card) => (
          <Link key={card.href} href={card.href}>
            <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-4">
                <p className="font-semibold text-sm">{card.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* "Reset Account" developer tool moved to Settings → Danger Zone
          in Commit 7. It's a user-facing self-action now, not an admin
          shortcut — reachable for every user at /dashboard/settings. */}

      {/* Recent signups */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Signups</CardTitle>
        </CardHeader>
        <CardContent>
          {!recentProfiles || recentProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No users yet.</p>
          ) : (
            <div className="space-y-2">
              {(recentProfiles as RecentProfile[]).map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between py-2 border-b last:border-0 text-sm"
                >
                  <div>
                    <span className="font-medium">
                      {profile.business_name ?? "Unnamed Truck"}
                    </span>
                    {profile.city && (
                      <span className="text-muted-foreground ml-2 text-xs">{profile.city}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs capitalize">
                      {profile.subscription_tier}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(profile.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
