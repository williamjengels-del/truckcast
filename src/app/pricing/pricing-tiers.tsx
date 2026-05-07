"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PRICING_PLANS,
  MAX_ANNUAL_SAVINGS,
  type BillingPeriod,
} from "@/lib/pricing-plans";

/**
 * Public pricing page tier cards + monthly/annual toggle.
 *
 * Authenticated checkout (POSTing to /api/stripe/checkout) lives on
 * /dashboard/settings/PlanCards — that path needs a session and a
 * Stripe customer record. This public version just routes "Start
 * free trial" to /signup with the chosen tier + billing as URL
 * params, so the signup flow can pre-select on day-2.
 *
 * Plan + price data lives in src/lib/pricing-plans.ts — single source
 * of truth shared with /dashboard/settings PlanCards. A price change
 * is a one-file edit there.
 */

export function PricingTiers() {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");

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
          Save up to {MAX_ANNUAL_SAVINGS}/yr
        </span>
      </div>

      {/* Three tier cards — equal weight, no "most popular" anchoring. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {PRICING_PLANS.map((plan) => {
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
                  Save {plan.annualSavings}/yr
                </p>
              )}
              <ul className="mt-6 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature.name} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
                    <span className="flex-1 inline-flex items-center gap-1.5">
                      {feature.name}
                      {feature.description && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={`More about ${feature.name}`}
                                className="text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:text-foreground"
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            }
                          />
                          <TooltipContent
                            side="top"
                            className="max-w-xs text-xs leading-relaxed"
                          >
                            {feature.description}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
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
