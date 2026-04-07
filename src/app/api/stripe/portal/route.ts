import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export async function POST(request: Request) {
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
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe customer found. Please subscribe first." },
        { status: 400 }
      );
    }

    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://vendcast.co";

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${origin}/dashboard/settings`,
      });
      return NextResponse.json({ url: session.url });
    } catch (stripeErr) {
      const msg = stripeErr instanceof Error ? stripeErr.message : "";
      // Stale test-mode customer ID — clear it so next checkout creates a fresh live customer
      if (msg.includes("No such customer")) {
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: null })
          .eq("id", user.id);
        return NextResponse.json(
          { error: "Billing session expired. Please re-subscribe to manage your plan." },
          { status: 400 }
        );
      }
      throw stripeErr;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
