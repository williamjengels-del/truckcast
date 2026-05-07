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
//
// Tier structure locked 2026-05-07 from operator audit. Key decisions:
//   - Forecasts available on every tier (Starter gets point estimate;
//     Pro+ adds weather adjustment + confidence ranges + plain-English
//     notes).
//   - Direct inquiries available on every tier — no paywall on
//     responding to leads. Operators help each other, no middleman.
//   - Day-of-event card tier-gates content (see day-of-event-block.tsx
//     gating logic):
//       Starter: event name, time-to-setup, address, start/end time
//       Pro: + parking, contacts, weather, prep, sales pace, etc.
//       Premium: + hourly weather forecast on day-of card
//   - Custom domain (yourbusiness.vendcast.co) moved to roadmap.
//   - "Assistant" = Tier-A chatbot (Pro). "Advanced Assistant" =
//     Tier-B chatbot with multi-step research tools (Premium-only).

export type PricingTier = "starter" | "pro" | "premium";
export type BillingPeriod = "monthly" | "annual";

export interface PricingFeature {
  /** The feature name as displayed in the tier card. */
  name: string;
  /** Optional one-sentence explainer surfaced as a tooltip on hover.
   *  Keep under ~120 chars. Use for features whose name isn't
   *  self-explanatory ("Schedule page", "Team share link",
   *  "Organizer scoring", etc.). Skip for obvious features. */
  description?: string;
}

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
  features: PricingFeature[];
}

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    tier: "starter",
    label: "Starter",
    monthlyPrice: "$19",
    annualPrice: "$182",
    annualSavings: "$46",
    description: "For solo operators getting started.",
    features: [
      { name: "Event scheduling & calendar" },
      { name: "Fee calculator & revenue tracking" },
      {
        name: "Schedule page (vendcast.co URL)",
        description:
          "A public page at vendcast.co/your-business showing your upcoming events — share the link in your bio or with regulars.",
      },
      {
        name: "Team share link",
        description:
          "A read-only link your team can open without a login to see today's schedule.",
      },
      {
        name: "CSV import",
        description:
          "Bring your past events in from a spreadsheet — Airtable, Google Sheets, Excel, or a Square/Toast export.",
      },
      {
        name: "Forecasts: point estimate, every event",
        description:
          "Every booked event gets a single-number sales prediction grounded in your history.",
      },
      {
        name: "Direct inquiries from organizers (unlimited)",
        description:
          "Organizers searching VendCast can request a quote from you directly — zero commission, no middleman.",
      },
    ],
  },
  {
    tier: "pro",
    label: "Pro",
    monthlyPrice: "$39",
    annualPrice: "$374",
    annualSavings: "$94",
    description: "The full forecasting toolkit and integrations.",
    features: [
      { name: "Everything in Starter, plus:" },
      {
        name: "Weather-adjusted forecasts with confidence ranges",
        description:
          "Forecasts factor in weather (rain, heat, cold) and surface a low/high range alongside the point estimate.",
      },
      {
        name: "Plain-English forecast notes",
        description:
          "Each forecast comes with one or two human-readable lines explaining why it lands where it does.",
      },
      {
        name: "POS integration (Toast, Square, Clover, SumUp)",
        description:
          "Connect your POS once and sales log themselves to the right event — no manual entry after each shift.",
      },
      {
        name: "Event performance analytics",
        description:
          "Per-event-name rollups: average sales, times booked, trend, accuracy of past forecasts.",
      },
      {
        name: "Day-of-event card (full)",
        description:
          "Parking notes, contact deep-links, weather, sales-pace bar, in-service notes, content capture, after-event wrap-up — everything for the actual event day.",
      },
      {
        name: "Assistant (ask questions about your events)",
        description:
          "Chat with your data — \"what was my best Friday last summer?\", \"compare Sunset Hills to Best of Missouri Market\", etc.",
      },
      {
        name: "1 team seat",
        description:
          "Invite one manager to log sales and view events on your behalf without sharing your password.",
      },
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
      { name: "Everything in Pro, plus:" },
      {
        name: "Advanced analytics & monthly reports",
        description:
          "Deeper rollups across event types, locations, and seasons — plus an emailed monthly summary.",
      },
      {
        name: "Organizer scoring",
        description:
          "Auto-scored organizers based on past event quality, payment timeliness, and operational fit so you know which leads to chase.",
      },
      {
        name: "Follow My Truck subscriber list",
        description:
          "Your customers can subscribe to your schedule — they get notified when you book new events nearby.",
      },
      {
        name: "Embeddable booking widget",
        description:
          "Drop a small VendCast widget into your own website or Linktree so visitors can request bookings without leaving your site.",
      },
      {
        name: "Hourly weather forecast on day-of card",
        description:
          "Hour-by-hour temperature and conditions during your service window — plus a wind alert when canopy-threatening gusts are forecast.",
      },
      {
        name: "Advanced Assistant (deeper analysis with multi-step research)",
        description:
          "A more capable chat that fetches and combines data across your full history — best for \"go find me X\" questions.",
      },
      {
        name: "Up to 5 team seats",
        description:
          "Invite up to five managers to log sales and view events on your behalf without sharing your password.",
      },
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
