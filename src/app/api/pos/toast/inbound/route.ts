import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PostalMime from "postal-mime";
import { parseToastEmail } from "@/lib/pos/toast";
import { calculateEventPerformance } from "@/lib/event-performance";
import { calculateForecast, calibrateCoefficients } from "@/lib/forecast-engine";
import type { Event } from "@/lib/database.types";

/**
 * POST /api/pos/toast/inbound
 *
 * Called by the Cloudflare Email Worker when a Toast daily summary
 * email is forwarded to sync+{token}@vendcast.co.
 *
 * User identification: we extract the plus-tag token from the "to" address.
 * The token is the first 8 characters of the user's UUID (dashes removed).
 * e.g. sync+abc12345@vendcast.co → look for user whose ID starts with "abc12345"
 *
 * Always returns 200 to prevent retries.
 */

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Extract the plus-tag token from the to address.
 * "sync+abc12345@vendcast.co" → "abc12345"
 * Handles both plain and "Display Name <email>" formats.
 */
function extractToken(to: string): string | null {
  const emailMatch = to.match(/<([^>]+)>/) ?? to.match(/^(\S+@\S+)$/);
  const email = emailMatch ? emailMatch[1] : to.trim();
  const local = email.split("@")[0];
  const plusIdx = local.indexOf("+");
  if (plusIdx === -1) return null;
  const tag = local.slice(plusIdx + 1).trim();
  return tag.length > 0 ? tag : null;
}

/** Find user by matching the first 8 chars of their UUID against the token. */
async function findUserByToken(
  supabase: ReturnType<typeof createServiceRoleClient>,
  token: string
): Promise<string | null> {
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const match = authData?.users?.find((u) =>
    u.id.replace(/-/g, "").startsWith(token)
  );
  return match?.id ?? null;
}

/**
 * Parse a raw MIME email string and return { subject, text }.
 * Falls back to treating the raw string as plain text if parsing fails.
 */
async function extractEmailContent(
  rawText: string,
  subjectFallback: string
): Promise<{ subject: string; text: string }> {
  // Only try MIME parsing if it looks like a MIME email
  if (rawText.match(/^(MIME-Version|Content-Type|From|To|Subject):/im)) {
    try {
      const bytes = new TextEncoder().encode(rawText);
      const parsed = await new PostalMime().parse(bytes.buffer as ArrayBuffer);
      const subject = parsed.subject ?? subjectFallback;

      function stripHtml(html: string): string {
        return html
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/\s+/g, " ");
      }

      let text = parsed.text ?? "";
      if (parsed.html) text += "\n" + stripHtml(parsed.html);

      // Gmail wraps forwarded emails as message/rfc822 attachments —
      // recursively parse each to find the actual Toast content
      for (const att of parsed.attachments ?? []) {
        if (att.mimeType === "message/rfc822" && att.content) {
          try {
            const nested = await new PostalMime().parse(att.content);
            if (nested.text) text += "\n" + nested.text;
            if (nested.html) text += "\n" + stripHtml(nested.html);
          } catch {
            // ignore parse failures on nested parts
          }
        }
      }

      // Log lines containing "sales" or "$" to diagnose format
      const diagLines = text.split(/\n/).filter(l => /sales|\$/i.test(l)).slice(0, 20);
      console.log(`[toast/inbound] MIME parsed — subject="${subject}" sales-related lines: ${JSON.stringify(diagLines)}`);
      return { subject, text };
    } catch (e) {
      console.warn("[toast/inbound] MIME parse failed, falling back to raw text:", e);
    }
  }
  // Not MIME or parse failed — use as-is
  console.log(`[toast/inbound] Using raw text (non-MIME). Preview: ${rawText.slice(0, 400)}`);
  return { subject: subjectFallback, text: rawText };
}

/** Inline recalculation using the service role client. */
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
  const upcoming = allEvents.filter((e) => e.event_date >= today && e.booked);
  for (const event of upcoming) {
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
  try {
    const payload = await request.json() as {
      to?: string | string[];
      from?: string;
      subject?: string;
      text?: string;
    };

    const { to = [], from = "", subject: rawSubject = "", text: rawBody = "" } = payload;
    const toAddresses = Array.isArray(to) ? to : [to];

    console.log(`[toast/inbound] from="${from}" to=${JSON.stringify(toAddresses)} subject="${rawSubject}"`);

    // Extract token from to address
    const token = toAddresses.map(extractToken).find(Boolean) ?? null;
    if (!token) {
      console.warn(`[toast/inbound] No plus-tag token found in: ${JSON.stringify(toAddresses)}`);
      return NextResponse.json({ ok: false, reason: "no_token" }, { status: 200 });
    }

    // Find user by token
    const supabase = createServiceRoleClient();
    const userId = await findUserByToken(supabase, token);
    if (!userId) {
      console.warn(`[toast/inbound] No user found for token: ${token}`);
      return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 200 });
    }

    // Extract subject + plain text from the raw MIME email
    const { subject, text } = await extractEmailContent(rawBody, rawSubject);

    // Include raw body too — catches content in nested message/rfc822 parts
    // that postal-mime doesn't unwrap (e.g. Gmail forwarded messages)
    const rawText = [subject, text, rawBody].filter(Boolean).join("\n");
    let parsed: { date: string; netSales: number; rawSubject: string };
    try {
      parsed = parseToastEmail(rawText);
    } catch (parseErr) {
      console.warn(`[toast/inbound] Parse failed for user ${userId}:`, parseErr);
      return NextResponse.json({ ok: false, reason: "parse_failed" }, { status: 200 });
    }

    // Find booked events on that date
    const { data: matchedEvents, error: eventsError } = await supabase
      .from("events")
      .select("id, event_name, user_id")
      .eq("user_id", userId)
      .eq("event_date", parsed.date)
      .eq("booked", true);

    if (eventsError) {
      console.error(`[toast/inbound] DB error for user ${userId}:`, eventsError);
      return NextResponse.json({ ok: false, reason: "db_error" }, { status: 200 });
    }

    if (!matchedEvents || matchedEvents.length === 0) {
      console.log(`[toast/inbound] No booked events for user ${userId} on ${parsed.date}`);
      return NextResponse.json({ ok: true, reason: "no_event_match", date: parsed.date }, { status: 200 });
    }

    if (matchedEvents.length > 1) {
      console.log(`[toast/inbound] Ambiguous: ${matchedEvents.length} events for user ${userId} on ${parsed.date}`);
      return NextResponse.json({ ok: true, reason: "ambiguous_match" }, { status: 200 });
    }

    // Exactly one match — sync it
    const event = matchedEvents[0];
    const { error: updateError } = await supabase
      .from("events")
      .update({ net_sales: parsed.netSales, pos_source: "toast" })
      .eq("id", event.id)
      .eq("user_id", userId);

    if (updateError) {
      console.error(`[toast/inbound] Update failed for event ${event.id}:`, updateError);
      return NextResponse.json({ ok: false, reason: "update_failed" }, { status: 200 });
    }

    await supabase
      .from("pos_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_error: null,
      })
      .eq("user_id", userId)
      .eq("provider", "toast");

    await recalculateForUserServiceRole(supabase, userId);

    console.log(`[toast/inbound] Synced $${parsed.netSales} to "${event.event_name}" for user ${userId}`);
    return NextResponse.json(
      { ok: true, eventId: event.id, eventName: event.event_name, netSales: parsed.netSales },
      { status: 200 }
    );
  } catch (err) {
    console.error("[toast/inbound] Unexpected error:", err);
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 200 });
  }
}
