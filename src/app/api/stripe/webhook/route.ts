import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Use service role for webhook handling (not user-scoped)
function getAdminSupabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature verification failed` },
      { status: 400 }
    );
  }

  const supabase = getAdminSupabase();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      const tier = session.metadata?.tier;

      if (userId && tier) {
        await supabase
          .from("profiles")
          .update({
            subscription_tier: tier,
            stripe_subscription_id: session.subscription as string,
            stripe_customer_id: session.customer as string,
          })
          .eq("id", userId);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Map price ID to tier using our actual env-configured price IDs
      const priceId = subscription.items.data[0]?.price?.id;
      const priceToTier: Record<string, string> = {
        [process.env.STRIPE_STARTER_MONTHLY_PRICE_ID ?? ""]: "starter",
        [process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? ""]: "starter",
        [process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? ""]: "pro",
        [process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? ""]: "pro",
        [process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID ?? ""]: "premium",
        [process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID ?? ""]: "premium",
      };
      const tier = priceToTier[priceId ?? ""] ?? "starter";

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .limit(1);

      if (profiles && profiles.length > 0) {
        await supabase
          .from("profiles")
          .update({ subscription_tier: tier })
          .eq("id", profiles[0].id);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .limit(1);

      if (profiles && profiles.length > 0) {
        await supabase
          .from("profiles")
          .update({
            subscription_tier: "starter",
            stripe_subscription_id: null,
          })
          .eq("id", profiles[0].id);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
