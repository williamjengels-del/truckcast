// Canonical plan + pricing definitions for VendCast.
//
// Two surfaces consume this:
//   1. /pricing  (src/app/pricing/pricing-tiers.tsx) — public marketing
//      page; routes "Start free trial" to /signup with the chosen
//      tier + billing as URL params.
//   2. /dashboard/settings PlanCards (src/app/dashboard/settings/page.tsx)
//      — authenticated checkout, POSTs to /api/stripe/checkout.
//
// Before consolidation each surface had its own inline constant with
// drifting copy + slightly different shapes (one used "$19/mo" with
// suffix baked in, the other used "$19" raw). Single source of truth
// means a Stripe price change + tier-feature update is a one-file edit.
//
// Stripe price IDs live separately in src/lib/stripe.ts STRIPE_PLANS;
// keep that and this in sync when prices change. The numbers here are
// presentation-only — the actual charge amount is whatever Stripe's
// price ID resolves to. If they drift, this file lies to operators on
// the marketing page; verify before shipping a price change.

export type PricingTier = "starter" | "pro" | "premium";
export type BillingPeriod = "monthly" | "annual";

export interface PricingPlan {
  tier: PricingTier;
  label: string;
  /** Whole-dollar string, no suffix. Consumers append "/mo". */
  monthlyPrice: string;
  /** Whole-dollar string, no suffix. Consumers append "/yr". */
  annualPrice: string;
  /** Annual savings, used by /pricing's "Save $X/yr" hint and
   *  settings' "save $X annually" subline. */
  annualSavings: string;
  /** One-sentence value framing for /pricing card subtitles.
   *  Settings ignores this — its layout is denser. */
  description: string;
  features: string[];
}

export const PRICING_PLANS: readonly PricingPlan[] = [
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
] as const;

/** Highest annual savings across all tiers, used by /pricing's
 *  "Save up to $X/yr" toggle hint. Computed from PRICING_PLANS so a
 *  price change updates the hint automatically — no second source of
 *  truth to keep in sync. */
export const MAX_ANNUAL_SAVINGS: string = PRICING_PLANS.reduce(
  (max, plan) => {
    const n = Number(plan.annualSavings.replace(/[^\d.]/g, ""));
    const maxN = Number(max.replace(/[^\d.]/g, ""));
    return n > maxN ? plan.annualSavings : max;
  },
  "$0"
);

/** Lookup helper for callers that have a tier string from a URL param
 *  or DB row and want the canonical record. Returns null on unknown
 *  values rather than throwing — read paths shouldn't crash on stale
 *  data. */
export function findPlanByTier(tier: string | null | undefined): PricingPlan | null {
  if (!tier) return null;
  return PRICING_PLANS.find((p) => p.tier === tier) ?? null;
}
