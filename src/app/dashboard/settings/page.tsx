"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useImpersonation } from "@/components/impersonation-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Check } from "lucide-react";
import { EmbedWidgetSection } from "@/components/embed-widget-section";
import { InstallSettingsCard } from "@/components/install-settings-card";
import { PushNotificationsCard } from "@/components/push-notifications-card";
import { DangerZoneCard } from "./danger-zone-card";
import type { Profile } from "@/lib/database.types";
import { PRICING_PLANS } from "@/lib/pricing-plans";
import { PublicSlugPicker } from "@/components/public-slug-picker";
import { TwoFactorCard } from "@/components/two-factor-card";
import { canonicalizeCity } from "@/lib/city-normalize";
import Link from "next/link";

type SettingsTab =
  | "profile"
  | "team"
  | "plan"
  | "customers"
  | "notifications"
  | "security";

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: "profile", label: "Profile" },
  // Team tab — promoted from a card buried inside the Profile tab.
  // Permissions matrix expansion is queued as a follow-up; this PR
  // ships the structural promotion only.
  { value: "team", label: "Team" },
  { value: "plan", label: "Plan" },
  { value: "customers", label: "Customers" },
  { value: "notifications", label: "Notifications" },
  { value: "security", label: "Security & Privacy" },
];

function isSettingsTab(v: string | null): v is SettingsTab {
  return (
    v === "profile" ||
    v === "team" ||
    v === "plan" ||
    v === "customers" ||
    v === "notifications" ||
    v === "security"
  );
}

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
  // effectiveUserId reruns the profile load on impersonation start/stop.
  const { effectiveUserId } = useImpersonation();

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
    // Read via /api/dashboard/profile — impersonation-aware server-side.
    //
    // The auto-save-business-name-from-user_metadata branch that used
    // to live here was a one-time migration for users whose profile
    // had a null business_name but whose auth.user_metadata still
    // carried the value from signup. It's been live long enough that
    // the migration has effectively run for everyone who needed it;
    // the fallback is dropped here to keep the read path clean.
    // Users can always edit business_name via the form below.
    async function loadProfile() {
      try {
        const res = await fetch("/api/dashboard/profile");
        if (res.ok) {
          const { profile } = (await res.json()) as { profile: Profile | null };
          setProfile(profile);
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [effectiveUserId]);

  // URL-driven tabs (?tab=profile|plan|customers|notifications|security).
  // Reading the URL (rather than only useState) means deep-links and refresh
  // both land on the right tab. Writing it back means each tab change is a
  // shareable URL — useful for support flows ("open this URL to find the
  // toggle"). Default = profile when ?tab= is missing or unrecognized.
  //
  // Hooks order note (regression caught during review of #77, fixed here):
  // these MUST live above the `if (loading)` early-return below. React's
  // Rules of Hooks require the same call sequence on every render; placing
  // hooks below an early-return causes the post-load render to add hooks
  // and trip "Rendered more hooks than during the previous render."
  const initialTab = ((): SettingsTab => {
    const t = searchParams.get("tab");
    return isSettingsTab(t) ? t : "profile";
  })();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Keep state in sync if the URL changes (back/forward, support deep-link).
  useEffect(() => {
    const t = searchParams.get("tab");
    if (isSettingsTab(t) && t !== activeTab) {
      setActiveTab(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = useCallback(
    (value: unknown) => {
      if (typeof value !== "string" || !isSettingsTab(value)) return;
      setActiveTab(value);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", value);
      router.replace(`/dashboard/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Auto-sync when returning from Stripe checkout. Land back on the Plan
  // tab so the operator sees their freshly-upgraded tier — pre-tabs this
  // didn't matter (single scroll), post-tabs the default ?tab=profile
  // landing made the verify-the-upgrade step require an extra click.
  useEffect(() => {
    if (searchParams.get("upgraded") === "true" && !syncing && !loading) {
      syncTier().then(() => {
        router.replace("/dashboard/settings?tab=plan");
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
        city: canonicalizeCity(profile.city),
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

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto p-1 w-full sm:w-fit">
          {SETTINGS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* PROFILE — business identity + team / managers. v25 §2e: account-
            management cards belong with profile (single locus for "who can
            touch this account"). */}
        <TabsContent value="profile" className="space-y-6">
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
                    placeholder="Enter your business name"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        </TabsContent>

        {/* TEAM — manager invites + read-only schedule share token.
            Promoted out of the Profile tab so team management gets
            its own dedicated surface; permission expansion will land
            here as a follow-up. */}
        <TabsContent value="team" className="space-y-6">
          <TeamAccessCard profile={profile} />
          <ManagerInviteCard profile={profile} />
        </TabsContent>

        {/* PLAN — subscription tier picker + Stripe billing portal */}
        <TabsContent value="plan" className="space-y-6">
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
        </TabsContent>

        {/* CUSTOMERS — surfaces the operator points the public at */}
        <TabsContent value="customers" className="space-y-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Public Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {profile?.subscription_tier === "starter" ? (
                <p className="text-sm text-muted-foreground">
                  Upgrade to Pro to get a shareable public schedule page.
                </p>
              ) : (
                <>
                  {/* Custom slug picker — Stage 2 of the custom-vendor-profile
                      workstream. Once Stage 3 ships the public /<slug>
                      route, an operator's claimed slug is the URL they
                      share publicly. Falls back to the UUID-based link
                      below until a slug is set. */}
                  {profile && (
                    <PublicSlugPicker
                      initialSlug={profile.public_slug ?? null}
                      businessName={profile.business_name ?? null}
                      onSaved={(next) =>
                        setProfile((p) => (p ? { ...p, public_slug: next } : p))
                      }
                    />
                  )}

                  {/* UUID fallback — always shown so the operator has a
                      permanent link even before they pick a slug. Will keep
                      working after Stage 3 ships (the /<slug> route is
                      additive, not a replacement). */}
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                      {profile?.public_slug ? "Or share the permanent UUID link:" : "Permanent link:"}
                    </p>
                    <code className="text-sm bg-muted p-2 rounded block break-all">
                      {typeof window !== "undefined"
                        ? `${window.location.origin}/schedule/${profile?.id}`
                        : `/schedule/${profile?.id}`}
                    </code>
                  </div>
                </>
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
        </TabsContent>

        {/* NOTIFICATIONS — email reminders + new-device login alerts + push */}
        <TabsContent value="notifications" className="space-y-6">
          <NotificationsCard
            profile={profile}
            onToggle={(val) =>
              setProfile((p) => (p ? { ...p, email_reminders_enabled: val } : p))
            }
            onLoginAlertToggle={(val) =>
              setProfile((p) =>
                p ? { ...p, login_notifications_enabled: val } : p
              )
            }
          />
          <PushNotificationsCard />
        </TabsContent>

        {/* SECURITY & PRIVACY — auth, data sharing, install/PWA, destructive */}
        <TabsContent value="security" className="space-y-6">
          <TwoFactorCard />
          <DataPrivacyCard
            profile={profile}
            onToggle={(val) =>
              setProfile((p) => (p ? { ...p, data_sharing_enabled: val } : p))
            }
          />
          <InstallSettingsCard />

          {/* Support link — small muted block above Danger Zone so
              operators always have a visible path to contact us without
              hunting through footer nav. Intentionally understated to
              keep Settings readable. */}
          <div className="text-center text-sm text-muted-foreground py-2">
            Need help?{" "}
            <Link href="/contact" className="text-primary hover:underline">
              Contact support
            </Link>
          </div>

          {/* Destructive actions — keep at the end of the security tab. */}
          <DangerZoneCard />
        </TabsContent>
      </Tabs>
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

  // Plan data sourced from src/lib/pricing-plans.ts — same constant
  // that drives /pricing. Display strings are composed inline because
  // the settings layout is denser than the marketing surface (price +
  // saving on the same row, no card description).
  const plans = PRICING_PLANS;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {plans.map((plan) => {
          const isCurrent = profile?.subscription_tier === plan.tier;
          // Pre-highlight the tier the operator clicked on /pricing
          // before signing up. Only when they're not already on it
          // (isCurrent wins visually — current state is louder than
          // intent). Subtle brand-orange ring rather than the full
          // brand-teal "current" treatment so the two states read
          // as distinct.
          const isIntended =
            !isCurrent &&
            profile?.intended_tier === plan.tier &&
            plan.tier !== "starter";
          return (
            <div
              key={plan.tier}
              data-intended={isIntended || undefined}
              className={`rounded-lg border p-4 space-y-3 ${
                isCurrent
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : isIntended
                    ? "border-brand-orange/50 ring-1 ring-brand-orange/40"
                    : "border-border"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-lg">{plan.label}</h3>
                  {isIntended && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-brand-orange">
                      Your pick
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {plan.monthlyPrice}/mo{" "}
                  <span className="text-xs">or {plan.annualPrice}/yr</span>
                </p>
                <p className="text-xs font-medium text-brand-orange">save {plan.annualSavings} annually</p>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-teal" strokeWidth={2.5} />
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
  onLoginAlertToggle,
}: {
  profile: Profile | null;
  onToggle: (val: boolean) => void;
  onLoginAlertToggle: (val: boolean) => void;
}) {
  const [savingReminder, setSavingReminder] = useState(false);
  const [savingLoginAlert, setSavingLoginAlert] = useState(false);
  const supabase = createClient();

  // Default true when columns not yet present (null) — matches the
  // server-side default of the migrations that backed each flag.
  const reminderEnabled = profile?.email_reminders_enabled ?? true;
  const loginAlertEnabled = profile?.login_notifications_enabled ?? true;

  async function handleReminderToggle() {
    if (!profile) return;
    const next = !reminderEnabled;
    setSavingReminder(true);
    await supabase
      .from("profiles")
      .update({ email_reminders_enabled: next })
      .eq("id", profile.id);
    onToggle(next);
    setSavingReminder(false);
  }

  async function handleLoginAlertToggle() {
    if (!profile) return;
    const next = !loginAlertEnabled;
    setSavingLoginAlert(true);
    await supabase
      .from("profiles")
      .update({ login_notifications_enabled: next })
      .eq("id", profile.id);
    onLoginAlertToggle(next);
    setSavingLoginAlert(false);
  }

  return (
    <Card className="max-w-2xl" id="notifications">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm font-medium">Sales reminder emails</p>
              <p className="text-sm text-muted-foreground">
                Receive an email when a past event has no sales logged. Sent
                once, 1–3 days after the event date.
              </p>
            </div>
            <Button
              variant={reminderEnabled ? "default" : "outline"}
              size="sm"
              onClick={handleReminderToggle}
              disabled={savingReminder}
              className="shrink-0"
            >
              {savingReminder ? "Saving..." : reminderEnabled ? "On" : "Off"}
            </Button>
          </div>
          {!reminderEnabled && (
            <p className="text-xs text-muted-foreground rounded border border-dashed p-3">
              Sales reminder emails are turned off. You can re-enable at any
              time.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm font-medium">New-device sign-in alerts</p>
              <p className="text-sm text-muted-foreground">
                Email me when my account signs in from a device or location I
                haven&apos;t used recently. Sign-ins are still recorded either
                way — this only governs the email notification.
              </p>
            </div>
            <Button
              variant={loginAlertEnabled ? "default" : "outline"}
              size="sm"
              onClick={handleLoginAlertToggle}
              disabled={savingLoginAlert}
              className="shrink-0"
            >
              {savingLoginAlert ? "Saving..." : loginAlertEnabled ? "On" : "Off"}
            </Button>
          </div>
          {!loginAlertEnabled && (
            <p className="text-xs text-muted-foreground rounded border border-dashed p-3">
              New-device login alerts are turned off. Sign-ins are still
              recorded for security review.
            </p>
          )}
        </div>
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
              Allow VendCast to use your event data internally to improve forecast accuracy
              for all users. Your data is never sold or shared externally.{" "}
              <Link href="/privacy#model-improvement" className="text-primary hover:underline">
                Learn more
              </Link>
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
            Core VendCast functionality is unaffected.
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

// ---------------------------------------------------------------------------
// Manager Invite Card
// ---------------------------------------------------------------------------

interface TeamMemberRow {
  id: string;
  member_email: string;
  status: "pending" | "active";
  can_view_revenue: boolean;
  can_view_forecasts: boolean;
}

function ManagerInviteCard({ profile }: { profile: Profile | null }) {
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [canViewRevenue, setCanViewRevenue] = useState(false);
  const [canViewForecasts, setCanViewForecasts] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tier = profile?.subscription_tier ?? "starter";
  const limit = tier === "premium" ? 5 : tier === "pro" ? 1 : 0;
  const isPro = tier === "pro" || tier === "premium";

  async function loadMembers() {
    const res = await fetch("/api/team/invite");
    const data = await res.json();
    setMembers(data.members ?? []);
    setLoading(false);
  }

  useEffect(() => { loadMembers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setError(null);
    setSuccess(null);
    const res = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), can_view_revenue: canViewRevenue, can_view_forecasts: canViewForecasts }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Invite failed.");
    } else {
      setSuccess(`Invite sent to ${email.trim()}.`);
      setEmail("");
      setCanViewRevenue(false);
      setCanViewForecasts(false);
      await loadMembers();
    }
    setInviting(false);
  }

  async function handleRevoke(memberId: string) {
    if (!confirm("Remove this manager's access?")) return;
    setRevoking(memberId);
    await fetch("/api/team/invite", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId }),
    });
    await loadMembers();
    setRevoking(null);
  }

  return (
    <Card className="max-w-2xl" id="managers">
      <CardHeader>
        <CardTitle>Manager Access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Invite managers to log event bookings and sales on your behalf.
          They get their own login — no password sharing.
        </p>

        {!isPro && (
          <div className="rounded-md border border-brand-orange/40 bg-brand-orange/5 p-3">
            <p className="text-sm text-foreground">
              Manager access requires a Pro or Premium subscription.{" "}
              <Link href="/dashboard/settings?tab=plan" className="font-medium text-brand-orange underline-offset-2 hover:underline">Upgrade your plan</Link>
            </p>
          </div>
        )}

        {/* Current members */}
        {isPro && (
          <>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : members.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Current managers ({members.length}/{limit})
                </p>
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div className="space-y-0.5">
                      <p className="font-medium">{m.member_email}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.status === "pending" ? "⏳ Invite pending" : "✓ Active"}
                        {m.can_view_revenue && " · can see revenue"}
                        {m.can_view_forecasts && " · can see forecasts"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive shrink-0"
                      onClick={() => handleRevoke(m.id)}
                      disabled={revoking === m.id}
                    >
                      {revoking === m.id ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No managers yet.</p>
            )}

            {/* Invite form */}
            {members.length < limit && (
              <form onSubmit={handleInvite} className="space-y-3 rounded-md border p-4">
                <p className="text-sm font-medium">Invite a manager</p>
                <div className="space-y-1">
                  <Label htmlFor="manager-email">Email address</Label>
                  <Input
                    id="manager-email"
                    type="email"
                    placeholder="manager@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Permissions</p>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canViewForecasts}
                      onChange={(e) => setCanViewForecasts(e.target.checked)}
                      className="rounded"
                    />
                    Can view revenue forecasts
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canViewRevenue}
                      onChange={(e) => setCanViewRevenue(e.target.checked)}
                      className="rounded"
                    />
                    Can view actual revenue &amp; profit
                  </label>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm font-medium text-brand-teal">{success}</p>}
                <Button type="submit" size="sm" disabled={inviting || !email.trim()}>
                  {inviting ? "Sending invite…" : "Send Invite"}
                </Button>
              </form>
            )}

            {members.length >= limit && (
              <p className="text-xs text-muted-foreground">
                You&apos;ve reached the manager limit for your plan.{" "}
                {tier === "pro" && <Link href="/dashboard/settings?tab=plan" className="font-medium text-brand-orange underline-offset-2 hover:underline">Upgrade to Premium for up to 5 managers.</Link>}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
