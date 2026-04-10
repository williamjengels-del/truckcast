"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Check, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const PLANS = [
  {
    tier: "starter",
    label: "Starter",
    price: "$19",
    annual: "$182/yr",
    annualSave: "save $46",
    description: "Everything you need to track events and revenue.",
    features: [
      "Unlimited event scheduling",
      "Revenue & fee tracking",
      "Event performance analytics",
      "Public schedule page",
      "Team share link",
    ],
    highlight: false,
  },
  {
    tier: "pro",
    label: "Pro",
    price: "$39",
    annual: "$374/yr",
    annualSave: "save $94",
    description: "Forecasting and integrations for serious operators.",
    features: [
      "Everything in Starter",
      "Weather-adjusted forecasts",
      "POS integration (Square, Toast, Clover)",
      "CSV import",
      "Cross-operator event benchmarks",
    ],
    highlight: true,
  },
  {
    tier: "premium",
    label: "Premium",
    price: "$69",
    annual: "$662/yr",
    annualSave: "save $166",
    description: "Advanced analytics for high-volume operations.",
    features: [
      "Everything in Pro",
      "Organizer scoring & risk analysis",
      "Monthly revenue reports",
      "Follow My Truck (fan notifications)",
      "Booking widget",
    ],
    highlight: false,
  },
];

export default function UpgradePage() {
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

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
      {/* Header */}
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
        {PLANS.map((plan) => (
          <div
            key={plan.tier}
            className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
              plan.highlight
                ? "border-primary ring-2 ring-primary bg-primary/5"
                : "border-border bg-card"
            }`}
          >
            {plan.highlight && (
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
                <span className="text-3xl font-bold">{plan.price}</span>
                <span className="text-muted-foreground text-sm">/mo</span>
              </div>
              {billing === "annual" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {plan.annual}{" "}
                  <span className="text-green-600 font-medium">
                    ({plan.annualSave})
                  </span>
                </p>
              )}
            </div>

            <ul className="space-y-2 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              className="w-full"
              variant={plan.highlight ? "default" : "outline"}
              disabled={loading !== null}
              onClick={() => handleCheckout(plan.tier)}
            >
              {loading === plan.tier
                ? "Loading..."
                : `Get ${plan.label}`}
            </Button>
          </div>
        ))}
      </div>

      {error && (
        <div className="max-w-3xl w-full mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
          {error}
        </div>
      )}

      {/* Footer links */}
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <a
          href="/dashboard/settings"
          className="hover:text-foreground transition-colors"
        >
          Already upgraded? Go to settings
        </a>
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
