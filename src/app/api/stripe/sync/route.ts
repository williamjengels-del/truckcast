import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

/**
 * Client-side fallback to sync Stripe subscription tier.
 * Called after returning from checkout — doesn't rely on webhooks.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, subscription_tier")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ tier: profile?.subscription_tier ?? "starter" });
    }

    // Get active subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 10,
    });

    if (subscriptions.data.length === 0) {
      // No active subscription — set to starter
      await supabase
        .from("profiles")
        .update({ subscription_tier: "starter", stripe_subscription_id: null })
        .eq("id", user.id);
      return NextResponse.json({ tier: "starter" });
    }

    // Map price ID to tier
    const priceToTier: Record<string, string> = {
      [process.env.STRIPE_STARTER_MONTHLY_PRICE_ID ?? ""]: "starter",
      [process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? ""]: "starter",
      [process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? ""]: "pro",
      [process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? ""]: "pro",
      [process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID ?? ""]: "premium",
      [process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID ?? ""]: "premium",
    };

    // Find the highest tier among active subscriptions
    const tierRank: Record<string, number> = {
      starter: 0,
      pro: 1,
      premium: 2,
    };

    let bestTier = "starter";
    let bestSubId = subscriptions.data[0].id;

    for (const sub of subscriptions.data) {
      const priceId = sub.items.data[0]?.price?.id;
      const tier = priceToTier[priceId ?? ""] ?? "starter";
      if (tierRank[tier] > tierRank[bestTier]) {
        bestTier = tier;
        bestSubId = sub.id;
      }
    }

    // Cancel duplicate subscriptions (keep only the best one)
    for (const sub of subscriptions.data) {
      if (sub.id !== bestSubId) {
        try {
          await stripe.subscriptions.cancel(sub.id);
        } catch {
          // Ignore cancel errors for already-cancelled subs
        }
      }
    }

    // Update profile
    await supabase
      .from("profiles")
      .update({
        subscription_tier: bestTier,
        stripe_subscription_id: bestSubId,
      })
      .eq("id", user.id);

    return NextResponse.json({ tier: bestTier, synced: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
