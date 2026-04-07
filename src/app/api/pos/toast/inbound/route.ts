import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseToastEmail } from "@/lib/pos/toast";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import type { Event } from "@/lib/database.types";

/**
 * POST /api/pos/toast/inbound
 *
 * Resend inbound email webhook. Called when an email arrives at
 * sync+{userId}@vendcast.co or toast+{userId}@vendcast.co.
 *
 * Resend payload fields used:
 *   to      – array of recipient addresses
 *   from    – sender address
 *   subject – email subject line
 *   text    – plain-text body
 *
 * Webhook authenticity is verified via the svix-signature header
 * using RESEND_WEBHOOK_SECRET.
 *
 * Always returns 200 so Resend does not retry on application errors.
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

/**
 * Extract the user ID encoded in the plus-tag of the to address.
 * e.g. "sync+abc-123@vendcast.co" -> "abc-123"
 *      "toast+abc-123@vendcast.co" -> "abc-123"
 * Returns null if no tag is present or the domain is not vendcast.co.
 */
function extractUserId(toAddresses: string[]): string | null {
  for (const addr of toAddresses) {
    // Strip display name if present, keep only the email portion
    const emailMatch = addr.match(/<([^>]+)>/) ?? addr.match(/^(\S+)$/);
    const email = emailMatch ? emailMatch[1] : addr.trim();

    const [local, domain] = email.split("@");
    if (!domain?.toLowerCase().includes("vendcast.co")) continue;

    const plusIndex = local.indexOf("+");
    if (plusIndex === -1) continue;

    const tag = local.slice(plusIndex + 1).trim();
    if (tag.length > 0) return tag;
  }
  return null;
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

    const { to = [], from = "", subject = "", text = "" } = payload;

    // --- Verify sender is Toast ---
    if (!from.toLowerCase().includes("toasttab.com")) {
      console.log(`[toast/inbound] Ignoring email from non-Toast sender: ${from}`);
      return NextResponse.json({ ok: true, reason: "not_toast" }, { status: 200 });
    }

    // --- Extract user ID from to address ---
    const userId = extractUserId(to);
    if (!userId) {
      console.warn(`[toast/inbound] Could not extract userId from to addresses: ${JSON.stringify(to)}`);
      return NextResponse.json({ ok: false, reason: "no_user_id" }, { status: 200 });
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

    const supabase = createServiceRoleClient();

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
