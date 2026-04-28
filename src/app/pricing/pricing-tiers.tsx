"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

/**
 * Public pricing page tier cards + monthly/annual toggle.
 *
 * Authenticated checkout (POSTing to /api/stripe/checkout) lives on
 * /dashboard/settings/PlanCards — that path needs a session and a
 * Stripe customer record. This public version just routes "Start
 * free trial" to /signup with the chosen tier + billing as URL
 * params, so the signup flow can pre-select on day-2.
 *
 * Plan constant duplicates the one inside dashboard/settings/page.tsx's
 * PlanCards. Worth consolidating into src/lib/pricing-plans.ts later;
 * left inline here to keep this PR scoped to the marketing surface.
 */

type Billing = "monthly" | "annual";

interface PricingPlan {
  tier: "starter" | "pro" | "premium";
  label: string;
  monthlyPrice: string;
  annualPrice: string;
  annualSavings: string;
  description: string;
  features: string[];
}

const PLANS: PricingPlan[] = [
  {
    tier: "starter",
    label: "Starter",
    monthlyPrice: "$19",
    annualPrice: "$182",
    annualSavings: "$46",
    description: "The essentials for a single-truck operator.",
    features: [
      "Event scheduling & calendar",
      "Fee calculator",
      "Revenue tracking",
      "Public schedule page",
      "Team share link",
    ],
  },
  {
    tier: "pro",
    label: "Pro",
    monthlyPrice: "$39",
    annualPrice: "$374",
    annualSavings: "$94",
    description: "Forecasting, integrations, and the full data toolkit.",
    features: [
      "Everything in Starter",
      "Weather-adjusted forecasts",
      "CSV import",
      "POS integration (Toast, Square, Clover, SumUp)",
      "Event performance analytics",
    ],
  },
  {
    tier: "premium",
    label: "Premium",
    monthlyPrice: "$69",
    annualPrice: "$662",
    annualSavings: "$166",
    description: "For multi-event operators and growing teams.",
    features: [
      "Everything in Pro",
      "Advanced analytics",
      "Monthly reports",
      "Organizer scoring",
      "Follow My Schedule",
      "Embeddable booking widget",
    ],
  },
];

export function PricingTiers() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="space-y-10">
      {/* Billing toggle — monthly default, annual shows total savings.
          Per v13 §5: drop "most popular" badge (no subscribers yet,
          would be fabricated trust signal). */}
      <div
        data-testid="pricing-billing-toggle"
        className="flex items-center justify-center gap-3"
      >
        <Button
          size="sm"
          variant={billing === "monthly" ? "default" : "outline"}
          onClick={() => setBilling("monthly")}
          data-testid="pricing-toggle-monthly"
          className="rounded-full px-5"
        >
          Monthly
        </Button>
        <Button
          size="sm"
          variant={billing === "annual" ? "default" : "outline"}
          onClick={() => setBilling("annual")}
          data-testid="pricing-toggle-annual"
          className="rounded-full px-5"
        >
          Annual
        </Button>
        <span
          data-testid="pricing-toggle-savings"
          className={`text-sm font-medium text-brand-orange transition-opacity ${
            billing === "annual" ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden={billing !== "annual"}
        >
          Save up to $166/yr
        </span>
      </div>

      {/* Three tier cards — equal weight, no "most popular" anchoring. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {PLANS.map((plan) => {
          const price = billing === "annual" ? plan.annualPrice : plan.monthlyPrice;
          const period = billing === "annual" ? "/yr" : "/mo";
          const signupHref = `/signup?plan=${plan.tier}&billing=${billing}`;
          return (
            <div
              key={plan.tier}
              data-testid={`pricing-card-${plan.tier}`}
              className="flex flex-col rounded-lg border bg-card p-8 shadow-sm"
            >
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                {plan.label}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {plan.description}
              </p>
              <div className="mt-6 flex items-baseline gap-1">
                <span
                  data-testid={`pricing-card-${plan.tier}-price`}
                  className="text-4xl font-bold text-brand-teal"
                >
                  {price}
                </span>
                <span className="text-base text-muted-foreground">{period}</span>
              </div>
              {billing === "annual" && (
                <p className="mt-1 text-sm font-medium text-brand-orange">
                  Save ${plan.annualSavings}/yr
                </p>
              )}
              <ul className="mt-6 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href={signupHref}>
                  <Button
                    data-testid={`pricing-card-${plan.tier}-cta`}
                    size="lg"
                    className="w-full"
                  >
                    Start free trial
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trial reassurance — same line as homepage footer CTA. */}
      <p className="text-center text-sm text-muted-foreground">
        14 days free, no credit card required. Cancel anytime.
      </p>
    </div>
  );
}
