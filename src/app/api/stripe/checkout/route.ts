import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe, STRIPE_PLANS } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tier, billing } = await request.json();

    // Derive base URL from request origin so it always works in all environments
    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://vendcast.co";

    if (!tier || !billing) {
      return NextResponse.json(
        { error: "Missing tier or billing period" },
        { status: 400 }
      );
    }

    const plan = STRIPE_PLANS[tier as keyof typeof STRIPE_PLANS];
    if (!plan) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }

    const priceId = billing === "annual" ? plan.annual : plan.monthly;
    if (!priceId) {
      return NextResponse.json(
        { error: "Price not configured" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    // Verify stored customer exists in current Stripe mode (test vs live IDs differ)
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        // Stale test-mode customer — create a fresh live one
        customerId = null;
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: null })
          .eq("id", user.id);
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Cancel any existing active subscriptions to prevent duplicates
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 10,
    });
    for (const sub of existingSubs.data) {
      await stripe.subscriptions.cancel(sub.id);
    }

    // Extended beta trial — all signups get a free trial through May 1, 2026.
    // After that date, remove this block and rely on Stripe price-level trial settings.
    const MAY_1_2026 = new Date("2026-05-01T00:00:00Z");
    const trialEnd =
      MAY_1_2026 > new Date()
        ? Math.floor(MAY_1_2026.getTime() / 1000)
        : undefined;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/settings?upgraded=true`,
      cancel_url: `${origin}/dashboard/settings`,
      metadata: { user_id: user.id, tier },
      ...(trialEnd ? { subscription_data: { trial_end: trialEnd } } : {}),
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
