// Alignment tests between PRICING_PLANS (presentation) and STRIPE_PLANS
// (the actual Stripe price IDs that get charged).
//
// PRICING_PLANS is the source of truth for what tiers we offer at the
// marketing level. STRIPE_PLANS resolves each tier to monthly/annual
// price IDs from env vars. These two MUST stay in lockstep:
//
//   * If a new tier shows up in PRICING_PLANS but not in STRIPE_PLANS,
//     the marketing page promises a tier that can't be checked out.
//     The /api/stripe/checkout route would 400 with "Invalid tier" or
//     "Price not configured" — silent until an operator hits it.
//   * If a tier disappears from PRICING_PLANS but lingers in
//     STRIPE_PLANS, that's a soft footgun (deprecated tier still
//     billable via direct API call) but not as urgent.
//
// These tests catch the first case at CI time so config drift fails
// fast instead of in production.

import { describe, expect, it } from "vitest";
import { PRICING_PLANS, findPlanByTier, MAX_ANNUAL_SAVINGS } from "./pricing-plans";
import { STRIPE_PLANS } from "./stripe";

describe("PRICING_PLANS / STRIPE_PLANS alignment", () => {
  it("every PRICING_PLANS tier has a matching STRIPE_PLANS entry", () => {
    for (const plan of PRICING_PLANS) {
      expect(
        STRIPE_PLANS,
        `STRIPE_PLANS missing entry for tier '${plan.tier}' — add monthly + annual env-var lookups in src/lib/stripe.ts`
      ).toHaveProperty(plan.tier);
    }
  });

  it("every STRIPE_PLANS entry has both monthly and annual slots", () => {
    for (const tier of Object.keys(STRIPE_PLANS) as (keyof typeof STRIPE_PLANS)[]) {
      const slot = STRIPE_PLANS[tier];
      expect(slot).toHaveProperty("monthly");
      expect(slot).toHaveProperty("annual");
      // Slots are typed as `string` — they default to "" when the
      // env var isn't set. We don't assert non-empty here because
      // CI doesn't have the prod env vars, but the SHAPE must be
      // present so /api/stripe/checkout can resolve the lookup.
      expect(typeof slot.monthly).toBe("string");
      expect(typeof slot.annual).toBe("string");
    }
  });

  it("PRICING_PLANS tier values match the STRIPE_PLANS key set exactly", () => {
    // Belt-and-suspenders: catches the reverse drift (extra tier in
    // STRIPE_PLANS that PRICING_PLANS dropped). Less urgent than the
    // forward direction but worth a CI signal — that lingering Stripe
    // entry is dead code.
    const presentationTiers = PRICING_PLANS.map((p) => p.tier).sort();
    const stripeTiers = Object.keys(STRIPE_PLANS).sort();
    expect(presentationTiers).toEqual(stripeTiers);
  });
});

describe("findPlanByTier", () => {
  it("returns the canonical record for a known tier", () => {
    const pro = findPlanByTier("pro");
    expect(pro).not.toBeNull();
    expect(pro?.label).toBe("Pro");
    expect(pro?.monthlyPrice).toBe("$39");
  });

  it("returns null for unknown / null / undefined input — does not throw", () => {
    expect(findPlanByTier("enterprise")).toBeNull();
    expect(findPlanByTier(null)).toBeNull();
    expect(findPlanByTier(undefined)).toBeNull();
    expect(findPlanByTier("")).toBeNull();
  });
});

describe("MAX_ANNUAL_SAVINGS", () => {
  it("equals the largest annualSavings across all PRICING_PLANS", () => {
    // Recompute from raw plans so the test catches a derivation bug
    // in pricing-plans.ts itself (not just the cached export).
    const expected = PRICING_PLANS.reduce((max, plan) => {
      const n = Number(plan.annualSavings.replace(/[^\d.]/g, ""));
      const maxN = Number(max.replace(/[^\d.]/g, ""));
      return n > maxN ? plan.annualSavings : max;
    }, "$0");
    expect(MAX_ANNUAL_SAVINGS).toBe(expected);
  });

  it("renders as a $-prefixed dollar string", () => {
    expect(MAX_ANNUAL_SAVINGS).toMatch(/^\$\d/);
  });
});
