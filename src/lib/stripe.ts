import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-03-25.dahlia",
});

export const STRIPE_PLANS = {
  starter: {
    monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID ?? "",
    annual: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? "",
  },
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? "",
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? "",
  },
  premium: {
    monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID ?? "",
    annual: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID ?? "",
  },
} as const;
