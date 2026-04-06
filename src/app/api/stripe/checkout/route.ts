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
    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://truckcast.co";

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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/settings?upgraded=true`,
      cancel_url: `${origin}/dashboard/settings`,
      metadata: { user_id: user.id, tier },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
