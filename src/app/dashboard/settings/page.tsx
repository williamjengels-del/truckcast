"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmbedWidgetSection } from "@/components/embed-widget-section";
import type { Profile } from "@/lib/database.types";

const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading...
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Sync subscription tier from Stripe (called after checkout redirect)
  async function syncTier() {
    setSyncing(true);
    try {
      const res = await fetch("/api/stripe/sync", { method: "POST" });
      const data = await res.json();
      if (data.tier) {
        setProfile((p) => p ? { ...p, subscription_tier: data.tier } : p);
      }
    } catch {
      // Silently fail — webhook may still handle it
    }
    setSyncing(false);
  }

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (data) {
          // If business_name is null, check user metadata as fallback
          if (!data.business_name) {
            const metaName = user.user_metadata?.business_name as string | undefined;
            if (metaName) {
              // Auto-save it to profile
              await supabase
                .from("profiles")
                .update({ business_name: metaName })
                .eq("id", user.id);
              setProfile({ ...data, business_name: metaName });
            } else {
              setProfile(data);
            }
          } else {
            setProfile(data);
          }
        }
      }
      setLoading(false);
    }
    loadProfile();
  }, [supabase]);

  // Auto-sync when returning from Stripe checkout
  useEffect(() => {
    if (searchParams.get("upgraded") === "true" && !syncing && !loading) {
      syncTier().then(() => {
        // Remove the query param so it doesn't re-sync on refresh
        router.replace("/dashboard/settings");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);

    await supabase
      .from("profiles")
      .update({
        business_name: profile.business_name,
        city: profile.city,
        state: profile.state,
        timezone: profile.timezone,
      })
      .eq("id", profile.id);

    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your business profile</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Business Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="businessName">Business Name</Label>
              <Input
                id="businessName"
                value={profile?.business_name ?? ""}
                onChange={(e) =>
                  setProfile((p) =>
                    p ? { ...p, business_name: e.target.value } : p
                  )
                }
                placeholder="Enter your food truck name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={profile?.city ?? ""}
                  onChange={(e) =>
                    setProfile((p) =>
                      p ? { ...p, city: e.target.value } : p
                    )
                  }
                  placeholder="e.g. St. Louis"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={profile?.state ?? ""}
                  onChange={(e) =>
                    setProfile((p) =>
                      p ? { ...p, state: e.target.value } : p
                    )
                  }
                  placeholder="MO"
                  maxLength={2}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                value={profile?.timezone ?? "America/Chicago"}
                onValueChange={(val) =>
                  setProfile((p) => (p ? { ...p, timezone: val ?? "America/Chicago" } : p))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {US_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace("_", " ").replace("America/", "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Current plan:{" "}
              <span className="font-medium text-foreground capitalize">
                {profile?.subscription_tier ?? "starter"}
              </span>
            </p>
            {syncing && (
              <span className="text-xs text-muted-foreground animate-pulse">
                Syncing...
              </span>
            )}
          </div>

          <PlanCards profile={profile} />

          {/* Manage existing billing */}
          {profile?.stripe_customer_id && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const res = await fetch("/api/stripe/portal", {
                    method: "POST",
                  });
                  const data = await res.json();
                  if (data.url) {
                    window.location.href = data.url;
                  } else {
                    alert("Billing portal error: " + (data.error ?? "Unknown error"));
                  }
                }}
              >
                Manage Billing & Invoices
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={syncing}
                onClick={syncTier}
              >
                {syncing ? "Syncing..." : "Sync Plan"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Public Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {profile?.subscription_tier === "starter" ? (
            <p className="text-sm text-muted-foreground">
              Upgrade to Pro to get a shareable public schedule page.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Your public schedule page:
              </p>
              <code className="text-sm bg-muted p-2 rounded block">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/schedule/${profile?.id}`
                  : `/schedule/${profile?.id}`}
              </code>
            </div>
          )}
        </CardContent>
      </Card>

      <FollowMyTruckSection profile={profile} />

      {profile && (
        <EmbedWidgetSection
          userId={profile.id}
          subscriptionTier={profile.subscription_tier ?? "starter"}
        />
      )}

      <NotificationsCard
        profile={profile}
        onToggle={(val) =>
          setProfile((p) => (p ? { ...p, email_reminders_enabled: val } : p))
        }
      />

      <DataPrivacyCard
        profile={profile}
        onToggle={(val) =>
          setProfile((p) => (p ? { ...p, data_sharing_enabled: val } : p))
        }
      />

      <TeamAccessCard profile={profile} />
    </div>
  );
}

function PlanCards({ profile }: { profile: Profile | null }) {
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleCheckout(tier: string, billing: string) {
    const key = `${tier}-${billing}`;
    setCheckoutLoading(key);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, billing }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setCheckoutError("Network error — please check your connection and try again.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  const plans = [
    {
      tier: "starter",
      label: "Starter",
      monthly: "$19/mo",
      annual: "$182/yr",
      annualSave: "save $46",
      features: ["Event Scheduling & Calendar", "Fee Calculator", "Revenue Tracking", "Public Schedule", "Team Share Link"],
    },
    {
      tier: "pro",
      label: "Pro",
      monthly: "$39/mo",
      annual: "$374/yr",
      annualSave: "save $94",
      features: ["Everything in Starter", "Weather-Adjusted Forecasts", "CSV Import", "POS Integration", "Event Performance Analytics"],
    },
    {
      tier: "premium",
      label: "Premium",
      monthly: "$69/mo",
      annual: "$662/yr",
      annualSave: "save $166",
      features: ["Everything in Pro", "Advanced Analytics", "Monthly Reports", "Organizer Scoring", "Follow My Truck", "Booking Widget"],
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {plans.map((plan) => {
          const isCurrent = profile?.subscription_tier === plan.tier;
          return (
            <div
              key={plan.tier}
              className={`rounded-lg border p-4 space-y-3 ${
                isCurrent
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border"
              }`}
            >
              <div>
                <h3 className="font-semibold text-lg">{plan.label}</h3>
                <p className="text-sm text-muted-foreground">
                  {plan.monthly}{" "}
                  <span className="text-xs">or {plan.annual}</span>
                </p>
                <p className="text-xs text-green-600">{plan.annualSave} annually</p>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1">
                    <span className="text-green-600 mt-0.5">&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <Button size="sm" disabled className="w-full">
                  Current Plan
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={checkoutLoading !== null}
                    onClick={() => handleCheckout(plan.tier, "monthly")}
                  >
                    {checkoutLoading === `${plan.tier}-monthly` ? "Loading..." : "Monthly"}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={checkoutLoading !== null}
                    onClick={() => handleCheckout(plan.tier, "annual")}
                  >
                    {checkoutLoading === `${plan.tier}-annual` ? "Loading..." : "Annual"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {checkoutError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="font-medium">Checkout error:</span> {checkoutError}
        </div>
      )}
    </div>
  );
}

function NotificationsCard({
  profile,
  onToggle,
}: {
  profile: Profile | null;
  onToggle: (val: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  // Default true when column not yet present (null)
  const enabled = profile?.email_reminders_enabled ?? true;

  async function handleToggle() {
    if (!profile) return;
    const next = !enabled;
    setSaving(true);
    await supabase
      .from("profiles")
      .update({ email_reminders_enabled: next })
      .eq("id", profile.id);
    onToggle(next);
    setSaving(false);
  }

  return (
    <Card className="max-w-2xl" id="notifications">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="text-sm font-medium">Sales reminder emails</p>
            <p className="text-sm text-muted-foreground">
              Receive an email when a past event has no sales logged. Sent
              once, 1–3 days after the event date.
            </p>
          </div>
          <Button
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={handleToggle}
            disabled={saving}
            className="shrink-0"
          >
            {saving ? "Saving..." : enabled ? "On" : "Off"}
          </Button>
        </div>
        {!enabled && (
          <p className="text-xs text-muted-foreground rounded border border-dashed p-3">
            Sales reminder emails are turned off. You can re-enable at any time.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DataPrivacyCard({
  profile,
  onToggle,
}: {
  profile: Profile | null;
  onToggle: (val: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const enabled = profile?.data_sharing_enabled ?? true;

  async function handleToggle() {
    if (!profile) return;
    const next = !enabled;
    setSaving(true);
    await supabase
      .from("profiles")
      .update({ data_sharing_enabled: next })
      .eq("id", profile.id);
    onToggle(next);
    setSaving(false);
  }

  return (
    <Card className="max-w-2xl" id="data-privacy">
      <CardHeader>
        <CardTitle>Data &amp; Privacy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="text-sm font-medium">Internal model improvement</p>
            <p className="text-sm text-muted-foreground">
              Allow TruckCast to use your event data internally to improve forecast accuracy
              for all users. Your data is never sold or shared externally.{" "}
              <a href="/privacy#model-improvement" className="text-primary hover:underline">
                Learn more
              </a>
            </p>
          </div>
          <Button
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={handleToggle}
            disabled={saving}
            className="shrink-0"
          >
            {saving ? "Saving..." : enabled ? "Enabled" : "Opted out"}
          </Button>
        </div>
        {!enabled && (
          <p className="text-xs text-muted-foreground rounded border border-dashed p-3">
            You&apos;ve opted out. Your events are excluded from internal analysis.
            Core TruckCast functionality is unaffected.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TeamAccessCard({ profile }: { profile: Profile | null }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadToken() {
      try {
        const res = await fetch("/api/team/token");
        const data = await res.json();
        setToken(data.token ?? null);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    }
    if (profile) loadToken();
  }, [profile]);

  const shareUrl =
    typeof window !== "undefined" && token
      ? `${window.location.origin}/team/${token}`
      : token
        ? `/team/${token}`
        : null;

  async function handleGenerate() {
    setWorking(true);
    try {
      const res = await fetch("/api/team/token", { method: "POST" });
      const data = await res.json();
      setToken(data.token ?? null);
    } finally {
      setWorking(false);
    }
  }

  async function handleRevoke() {
    if (!confirm("This will invalidate the current link for anyone using it. Are you sure?")) return;
    setWorking(true);
    try {
      await fetch("/api/team/token", { method: "DELETE" });
      const res = await fetch("/api/team/token", { method: "POST" });
      const data = await res.json();
      setToken(data.token ?? null);
    } finally {
      setWorking(false);
    }
  }

  function handleCopy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Team Access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Share this with employees and managers. They can view the schedule without logging in.
          No financial data is visible.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : token && shareUrl ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Your team share link:</p>
            <code className="text-sm bg-muted p-2 rounded block break-all">{shareUrl}</code>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy Link"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleRevoke}
                disabled={working}
              >
                {working ? "Working..." : "Revoke & Regenerate"}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={handleGenerate} disabled={working}>
            {working ? "Generating..." : "Generate Link"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function FollowMyTruckSection({ profile }: { profile: Profile | null }) {
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const supabase = createClient();

  const isPremium = profile?.subscription_tier === "premium";
  const followUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/follow/${profile?.id}`
      : `/follow/${profile?.id}`;

  useEffect(() => {
    async function loadCount() {
      if (!profile || !isPremium) return;
      const { count } = await supabase
        .from("follow_subscribers")
        .select("*", { count: "exact", head: true })
        .eq("truck_user_id", profile.id)
        .is("unsubscribed_at", null);
      setSubscriberCount(count ?? 0);
    }
    loadCount();
  }, [profile, isPremium, supabase]);

  function handleCopy() {
    navigator.clipboard.writeText(followUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Follow My Truck</CardTitle>
      </CardHeader>
      <CardContent>
        {!isPremium ? (
          <p className="text-sm text-muted-foreground">
            Upgrade to Premium to let customers subscribe to your event notifications.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                Active subscribers:{" "}
                <span className="font-semibold text-foreground">
                  {subscriberCount ?? "..."}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Share this link so customers can follow your truck:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-sm bg-muted p-2 rounded flex-1 break-all">
                  {followUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                >
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
