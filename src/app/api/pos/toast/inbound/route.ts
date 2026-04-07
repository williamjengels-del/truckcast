import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseToastEmail } from "@/lib/pos/toast";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import type { Event } from "@/lib/database.types";

/**
 * POST /api/pos/toast/inbound
 *
 * Called by the Cloudflare Email Worker when a Toast daily summary
 * email is forwarded to sync@vendcast.co.
 *
 * User identification: the "from" field is the user's forwarding email
 * (their Gmail/Outlook address). We look them up by email in Supabase Auth.
 * Everyone uses the same address — no user IDs needed.
 *
 * Always returns 200 to prevent retries.
 */

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase service role env vars");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Extract bare email address from "Display Name <email>" or plain "email" format. */
function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).trim().toLowerCase();
}

/** Look up a Supabase user ID by their email address. */
async function findUserByEmail(
  supabase: ReturnType<typeof createServiceRoleClient>,
  email: string
): Promise<string | null> {
  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const user = (data?.users ?? []).find(
    (u) => u.email?.toLowerCase() === email
  );
  return user?.id ?? null;
}

/**
 * Lightweight webhook signature check.
 * Resend uses Svix for inbound webhooks and sends these headers:
 *   svix-id, svix-timestamp, svix-signature
 *
 * Full Svix verification requires the svix npm package. We do a simple
 * presence-check here: the secret is required and the header must be present.
 * Replace with the svix SDK if you need cryptographic verification.
 */
function verifyWebhookSignature(request: Request): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is configured, skip verification (dev / not yet configured)
    console.warn("[toast/inbound] RESEND_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }
  const signature = request.headers.get("svix-signature");
  if (!signature) {
    console.warn("[toast/inbound] Missing svix-signature header");
    return false;
  }
  // With the secret present we at least confirm the header exists.
  // TODO: use the svix npm package for full HMAC verification:
  //   import { Webhook } from "svix";
  //   const wh = new Webhook(secret);
  //   wh.verify(rawBody, headers);
  return true;
}

/** Inline recalculation using the service role client (no user session). */
async function recalculateForUserServiceRole(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string
) {
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);

  const allEvents = (events ?? []) as Event[];

  const eventNames = [
    ...new Set(
      allEvents
        .filter((e) => e.booked && e.net_sales && e.net_sales > 0)
        .map((e) => e.event_name)
    ),
  ];

  for (const eventName of eventNames) {
    const perf = calculateEventPerformance(eventName, userId, allEvents);
    await supabase
      .from("event_performance")
      .upsert(perf as Record<string, unknown>, { onConflict: "user_id,event_name" });
  }

  const calibrated = calibrateCoefficients(allEvents);
  const today = new Date().toISOString().split("T")[0];
  const upcomingEvents = allEvents.filter((e) => e.event_date >= today && e.booked);

  for (const event of upcomingEvents) {
    const result = calculateForecast(event, allEvents, { calibratedCoefficients: calibrated });
    if (result) {
      await supabase
        .from("events")
        .update({ forecast_sales: result.forecast })
        .eq("id", event.id);
    }
  }
}

export async function POST(request: Request) {
  // Always return 200 to prevent Resend retries, even on errors.
  try {
    // Clone so we can read body for both signature check and parsing
    const cloned = request.clone();

    if (!verifyWebhookSignature(cloned)) {
      console.warn("[toast/inbound] Webhook signature verification failed");
      return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 200 });
    }

    const payload = await request.json() as {
      to?: string[];
      from?: string;
      subject?: string;
      text?: string;
      html?: string;
    };

    const { from = "", subject = "", text = "" } = payload;

    // --- Verify sender is Toast ---
    if (!from.toLowerCase().includes("toasttab.com")) {
      console.log(`[toast/inbound] Ignoring non-Toast email from: ${from}`);
      return NextResponse.json({ ok: true, reason: "not_toast" }, { status: 200 });
    }

    // --- Identify user by their forwarding email address ---
    // When a user forwards email from Gmail, "from" is their own email address.
    // We look them up in Supabase Auth to get their user ID.
    const supabase = createServiceRoleClient();
    const forwarderEmail = extractEmail(from);

    // Re-check: if from is still toasttab.com it means no forward happened (direct send test)
    // In that case we can't identify the user — skip gracefully
    const userId = forwarderEmail.includes("toasttab.com")
      ? null
      : await findUserByEmail(supabase, forwarderEmail);

    if (!userId) {
      console.warn(`[toast/inbound] Could not find user for email: ${forwarderEmail}`);
      return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 200 });
    }

    // --- Parse the email ---
    const rawText = [subject, text].filter(Boolean).join("\n");
    let parsed: { date: string; netSales: number; rawSubject: string };
    try {
      parsed = parseToastEmail(rawText);
    } catch (parseErr) {
      console.warn(`[toast/inbound] Parse failed for user ${userId}:`, parseErr);
      return NextResponse.json({ ok: false, reason: "parse_failed" }, { status: 200 });
    }

    // --- Find booked events on that date for this user ---
    const { data: matchedEvents, error: eventsError } = await supabase
      .from("events")
      .select("id, event_name, user_id")
      .eq("user_id", userId)
      .eq("event_date", parsed.date)
      .eq("booked", true);

    if (eventsError) {
      console.error(`[toast/inbound] DB error looking up events for user ${userId}:`, eventsError);
      return NextResponse.json({ ok: false, reason: "db_error" }, { status: 200 });
    }

    if (!matchedEvents || matchedEvents.length === 0) {
      console.log(`[toast/inbound] No booked events found for user ${userId} on ${parsed.date} — skipping`);
      return NextResponse.json({ ok: true, reason: "no_event_match", date: parsed.date }, { status: 200 });
    }

    if (matchedEvents.length > 1) {
      console.log(
        `[toast/inbound] Ambiguous: ${matchedEvents.length} booked events for user ${userId} on ${parsed.date} — skipping`
      );
      return NextResponse.json({ ok: true, reason: "ambiguous_match", count: matchedEvents.length }, { status: 200 });
    }

    // Exactly one match — auto-sync
    const event = matchedEvents[0];

    const { error: updateError } = await supabase
      .from("events")
      .update({ net_sales: parsed.netSales, pos_source: "toast" })
      .eq("id", event.id)
      .eq("user_id", userId);

    if (updateError) {
      console.error(`[toast/inbound] Failed to update event ${event.id}:`, updateError);
      return NextResponse.json({ ok: false, reason: "update_failed" }, { status: 200 });
    }

    // Update pos_connections sync metadata
    await supabase
      .from("pos_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_error: null,
      })
      .eq("user_id", userId)
      .eq("provider", "toast");

    // Recalculate event performance
    await recalculateForUserServiceRole(supabase, userId);

    console.log(
      `[toast/inbound] Synced $${parsed.netSales} to event "${event.event_name}" (${event.id}) for user ${userId}`
    );

    return NextResponse.json(
      { ok: true, eventId: event.id, eventName: event.event_name, netSales: parsed.netSales },
      { status: 200 }
    );
  } catch (err) {
    console.error("[toast/inbound] Unexpected error:", err);
    // Still return 200 to prevent Resend retries
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 200 });
  }
}
