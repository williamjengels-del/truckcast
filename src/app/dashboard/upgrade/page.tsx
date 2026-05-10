"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, Check, LogOut, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { PRICING_PLANS } from "@/lib/pricing-plans";

/**
 * Upgrade / change-plan page. Renders different framing based on the
 * operator's current subscription state:
 *   - Non-paying (trial expired or trialing) → "Your free trial has
 *     ended" copy + "Keep the momentum going" framing.
 *   - Paying (Pro / Premium with stripe_subscription_id) → "Change your
 *     plan" copy. The same plan-card grid renders in both cases — the
 *     header is the only difference.
 *
 * Pre-fix (production audit 2026-05-10): this page rendered the trial-
 * ended banner to ALL viewers including paying Premium subscribers,
 * which alarmed operators who clicked Upgrade to manage their plan and
 * saw "your data is safe, choose a plan." Trust-eroding for paying
 * customers.
 *
 * Tier data: read from the canonical PRICING_PLANS in
 * src/lib/pricing-plans.ts. The two other tier surfaces (/pricing
 * and /dashboard/settings) already consume that file.
 */
export default function UpgradePage() {
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState<boolean | null>(null);
  const [currentTier, setCurrentTier] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // Resolve subscription state on mount so the header copy can branch
  // correctly. Null state during fetch keeps the header neutral; once
  // resolved we render either the trial-ended or change-plan framing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_tier, stripe_subscription_id")
        .eq("id", user.id)
        .single();
      if (cancelled || !profile) return;
      setIsPaying(Boolean(profile.stripe_subscription_id));
      setCurrentTier(profile.subscription_tier ?? null);
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheckout(tier: string) {
    setLoading(tier);
    setError(null);
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
        setError(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center py-12 px-4">
      {/* Header — branches on subscription state. Renders neutral
          while the profile fetch is in flight to avoid a misleading
          flash of "trial ended" copy for paying subscribers. */}
      {isPaying === true ? (
        <div className="text-center mb-10 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-1.5 text-sm font-medium mb-4">
            <Settings className="h-4 w-4" />
            Manage your plan
            {currentTier && (
              <>
                {" "}<span className="text-primary/70">· currently on {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}</span>
              </>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            Change your subscription
          </h1>
          <p className="text-muted-foreground text-base">
            Pick a different plan, switch between monthly and annual billing,
            or compare what you&apos;d get on each tier.
          </p>
        </div>
      ) : isPaying === false ? (
        <div className="text-center mb-10 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-4 py-1.5 text-sm font-medium mb-4">
            <Sparkles className="h-4 w-4" />
            Your free trial has ended
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            Keep the momentum going
          </h1>
          <p className="text-muted-foreground text-base">
            Your events and data are safe. Choose a plan to unlock your dashboard
            and keep forecasting.
          </p>
        </div>
      ) : (
        // Loading — render a neutral header that doesn't lie either way.
        <div className="text-center mb-10 max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            Plans
          </h1>
        </div>
      )}

      {/* Billing toggle */}
      <div className="flex items-center gap-3 mb-8">
        <button
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            billing === "monthly"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setBilling("monthly")}
        >
          Monthly
        </button>
        <button
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            billing === "annual"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setBilling("annual")}
        >
          Annual
          <span className="ml-1.5 text-xs text-green-600 font-semibold">
            2 months free
          </span>
        </button>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl mb-8">
        {PRICING_PLANS.map((plan) => {
          const highlight = plan.tier === "pro";
          return (
            <div
              key={plan.tier}
              className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
                highlight
                  ? "border-primary ring-2 ring-primary bg-primary/5"
                  : "border-border bg-card"
              }`}
            >
              {highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                    Most popular
                  </span>
                </div>
              )}

              <div>
                <h2 className="text-lg font-bold">{plan.label}</h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                  {plan.description}
                </p>
              </div>

              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{plan.monthlyPrice}</span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                {billing === "annual" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {plan.annualPrice}/yr{" "}
                    <span className="text-green-600 font-medium">
                      (save {plan.annualSavings})
                    </span>
                  </p>
                )}
              </div>

              <ul className="space-y-2 flex-1">
                {plan.features.map((feature) => (
                  <li
                    key={feature.name}
                    className="flex items-start gap-2 text-sm"
                    title={feature.description}
                  >
                    <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                    {feature.name}
                  </li>
                ))}
              </ul>

              <Button
                className="w-full"
                variant={highlight ? "default" : "outline"}
                disabled={loading !== null || (isPaying === true && currentTier === plan.tier)}
                onClick={() => handleCheckout(plan.tier)}
              >
                {loading === plan.tier
                  ? "Loading..."
                  : isPaying === true && currentTier === plan.tier
                    ? "Current plan"
                    : isPaying === true
                      ? `Switch to ${plan.label}`
                      : `Get ${plan.label}`}
              </Button>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="max-w-3xl w-full mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
          {error}
        </div>
      )}

      {/* Footer links */}
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <Link
          href="/dashboard/settings"
          className="hover:text-foreground transition-colors"
        >
          Already upgraded? Go to settings
        </Link>
        <span>·</span>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground text-center max-w-sm">
        All plans include a 30-day money-back guarantee. Cancel anytime. Your
        data is always yours.
      </p>
    </div>
  );
}
