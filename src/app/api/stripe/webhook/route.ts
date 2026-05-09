import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
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

  // ── Idempotency gate ───────────────────────────────────────────────
  // Check whether this event.id has already been processed. Pre-fix,
  // a replay (or aggressive Stripe retry across borderline-timeout
  // responses) re-ran the switch and could downgrade-upgraded users
  // or clear failed-payment state on data that had since moved on.
  //
  // If the table doesn't exist yet (migration 20260509000006 not yet
  // pasted), the SELECT returns 42P01 — log and fall through to the
  // legacy non-idempotent path. After paste, the gate activates
  // automatically. Same paste-at-merge pattern as race-1 / event-tier.
  let idempotencyAvailable = true;
  try {
    const { data: existing, error: idempErr } = await supabase
      .from("stripe_processed_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();
    if (idempErr) {
      if (idempErr.code === "42P01") {
        idempotencyAvailable = false;
      } else {
        console.warn("[stripe-webhook] idempotency lookup error:", idempErr);
        idempotencyAvailable = false;
      }
    } else if (existing) {
      // Already processed — ack to Stripe so it stops retrying.
      return NextResponse.json({
        received: true,
        idempotent_skip: true,
        event_id: event.id,
      });
    }
  } catch (e) {
    console.warn("[stripe-webhook] idempotency lookup threw:", e);
    idempotencyAvailable = false;
  }

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

      // Stripe flips subscription.status to 'past_due' after its
      // configured number of invoice retry attempts exhaust. We mirror
      // that onto profiles.last_payment_status so the dunning UI + admin
      // triage pick it up even though payment_failed already fired on
      // the individual invoice attempts. When the card gets updated and
      // Stripe retries successfully, invoice.payment_succeeded fires
      // and flips status back to 'paid' — we don't need to undo here.
      const update: Record<string, unknown> = {
        subscription_tier: tier,
        stripe_subscription_id: subscription.id,
      };
      if (subscription.status === "past_due") {
        update.last_payment_status = "past_due";
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .limit(1);

      if (profiles && profiles.length > 0) {
        await supabase
          .from("profiles")
          .update(update)
          .eq("id", profiles[0].id);
      }

      if (subscription.status === "past_due") {
        Sentry.captureMessage("Stripe subscription transitioned to past_due", {
          level: "warning",
          tags: { source: "stripe_webhook", event_type: event.type },
          extra: {
            stripe_customer_id: customerId,
            subscription_id: subscription.id,
            status: subscription.status,
          },
        });
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

    // Renewal settled. Record the timestamp + clear any prior-cycle
    // failure reason so the operator's profile reflects the currently-
    // unresolved state only (not a stale "payment_failed" that's since
    // recovered).
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (!customerId) break;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .limit(1);

      if (profiles && profiles.length > 0) {
        await supabase
          .from("profiles")
          .update({
            last_payment_at: new Date().toISOString(),
            last_payment_status: "paid",
            last_payment_failure_reason: null,
          })
          .eq("id", profiles[0].id);
      }
      break;
    }

    // Renewal failed. Record the failure + the Stripe-reported reason so
    // dunning UI / admin triage can surface "why" without re-querying
    // Stripe. Also capture to Sentry so we see real-time payment
    // failures in the same place we see code errors — dunning isn't
    // silent anymore.
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (!customerId) break;

      // Payment-error message lives on the invoice's last payment
      // attempt, which the Stripe SDK surfaces as last_payment_error on
      // the embedded charge. Fall back to the invoice status if the
      // SDK shape is missing the field.
      type InvoiceWithCharge = Stripe.Invoice & {
        charge?: { failure_message?: string | null } | string | null;
      };
      const invoiceWithCharge = invoice as InvoiceWithCharge;
      const chargeRef = invoiceWithCharge.charge;
      const failureReason =
        (typeof chargeRef === "object" && chargeRef?.failure_message) ||
        invoice.status ||
        "unknown";

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .limit(1);

      if (profiles && profiles.length > 0) {
        await supabase
          .from("profiles")
          .update({
            last_payment_status: "payment_failed",
            last_payment_failure_reason: String(failureReason),
          })
          .eq("id", profiles[0].id);
      }

      Sentry.captureMessage("Stripe invoice.payment_failed", {
        level: "warning",
        tags: { source: "stripe_webhook", event_type: event.type },
        extra: {
          stripe_customer_id: customerId,
          invoice_id: invoice.id,
          amount_due: invoice.amount_due,
          failure_reason: failureReason,
          attempt_count: invoice.attempt_count,
        },
      });
      break;
    }
  }

  // Mark this event.id as processed. AFTER the switch (not before) so
  // a real processing failure leaves no stale row — Stripe retry will
  // re-run the case. ON CONFLICT DO NOTHING handles the rare
  // concurrent-retry race where two workers process the same event.id
  // (idempotent UPDATEs above mean this is harmless even if both
  // succeed in processing).
  if (idempotencyAvailable) {
    try {
      const { error: insertErr } = await supabase
        .from("stripe_processed_events")
        .insert({ id: event.id, type: event.type });
      // 23505 = unique_violation = concurrent worker beat us. Fine.
      if (insertErr && insertErr.code !== "23505") {
        console.warn(
          "[stripe-webhook] processed-events insert error:",
          insertErr
        );
      }
    } catch (e) {
      // Don't fail the webhook ack on idempotency-table issues — at
      // worst this means the same event might re-process if Stripe
      // retries (better than 5xx'ing successful processing).
      console.warn("[stripe-webhook] processed-events insert threw:", e);
    }
  }

  return NextResponse.json({ received: true });
}
