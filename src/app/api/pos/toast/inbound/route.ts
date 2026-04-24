import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PostalMime from "postal-mime";
import { parseToastEmail } from "@/lib/pos/toast";
import { recalculateForUserWithClient } from "@/lib/recalculate-service";

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

/** Status values written to pos_connections.last_sync_status.
 * Keep this set narrow + documented — the operator-facing UI reads
 * these and the stale-sync diagnostic (scripts/diagnose-stale-pos-syncs.mjs)
 * categorizes rows by them. If you add a new status, surface it there too. */
type ToastSyncStatus =
  | "success"          // net_sales updated on an event
  | "queued_for_review" // no booked event on reported date; payment saved to unmatched_toast_payments inbox for operator to route (catering deposit / remainder payment pattern)
  | "ambiguous_match"  // multiple booked events on that date; skipped to avoid miswrite
  | "parse_failed"     // parseToastEmail threw (Toast email format changed, or non-Toast content forwarded)
  | "db_error"         // Supabase query for events failed
  | "update_failed"    // the net_sales update itself failed
  | "pending_verify"   // gmail forwarding verification email arrived; URL surfaced to UI
  | "internal_error";  // catch-all for unexpected exceptions

/**
 * Write to pos_connections.{last_sync_at, last_sync_status, last_sync_error}.
 * Called from every branch that has a known userId — so the UI reflects
 * what actually happened per inbound email, not just the last success.
 *
 * Silently swallows errors from this write itself — we don't want a
 * logging-side failure to cascade into losing the email we're already
 * trying to process. The parent handler still returns 200 either way.
 */
async function recordSyncAttempt(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  status: ToastSyncStatus,
  error: string | null
): Promise<void> {
  try {
    await supabase
      .from("pos_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: status,
        last_sync_error: error,
      })
      .eq("user_id", userId)
      .eq("provider", "toast");
  } catch (e) {
    console.warn(`[toast/inbound] recordSyncAttempt failed for ${userId}:`, e);
  }
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


export async function POST(request: Request) {
  // Hoisted so the catch block can record `internal_error` against
  // the right pos_connections row if we got far enough to identify
  // the user before throwing.
  let supabase: ReturnType<typeof createServiceRoleClient> | null = null;
  let userId: string | null = null;

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

    // Detect Gmail forwarding verification emails — extract URL and surface it in the UI
    if (rawSubject.toLowerCase().includes("forwarding confirmation")) {
      console.log(`[toast/inbound] GMAIL VERIFICATION EMAIL DETECTED — parsing body...`);
      const tokenForVerify = toAddresses.map(extractToken).find(Boolean) ?? null;
      try {
        const bytes = new TextEncoder().encode(rawBody);
        const verifyParsed = await new PostalMime().parse(bytes.buffer as ArrayBuffer);
        const bodyText = (verifyParsed.text ?? "") + " " + (verifyParsed.html ?? "");
        const urlMatch = bodyText.match(/https:\/\/mail\.google\.com[^\s"<>]+/i)
          ?? bodyText.match(/https:\/\/[^\s"<>]*confirm[^\s"<>]*/i);
        const confirmUrl = urlMatch?.[0] ?? null;
        console.log(`[toast/inbound] CONFIRMATION URL: ${confirmUrl ?? "not found"}`);

        // Save the URL into pos_connections.last_sync_error so the UI can surface it
        if (confirmUrl && tokenForVerify) {
          const svc = createServiceRoleClient();
          const userId = await findUserByToken(svc, tokenForVerify);
          if (userId) {
            await svc
              .from("pos_connections")
              .update({ last_sync_error: `GMAIL_VERIFY:${confirmUrl}`, last_sync_status: "pending_verify" })
              .eq("user_id", userId)
              .eq("provider", "toast");
            console.log(`[toast/inbound] Stored verify URL for user ${userId}`);
          }
        }
      } catch (e) {
        console.log(`[toast/inbound] Verification parse error: ${e}`);
      }
      return NextResponse.json({ ok: true, reason: "gmail_verification_logged" }, { status: 200 });
    }

    // Extract token from to address
    const token = toAddresses.map(extractToken).find(Boolean) ?? null;
    if (!token) {
      console.warn(`[toast/inbound] No plus-tag token found in: ${JSON.stringify(toAddresses)}`);
      return NextResponse.json({ ok: false, reason: "no_token" }, { status: 200 });
    }

    // Find user by token
    supabase = createServiceRoleClient();
    userId = await findUserByToken(supabase, token);
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
      await recordSyncAttempt(
        supabase,
        userId,
        "parse_failed",
        parseErr instanceof Error ? parseErr.message : String(parseErr)
      );
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
      await recordSyncAttempt(supabase, userId, "db_error", eventsError.message);
      return NextResponse.json({ ok: false, reason: "db_error" }, { status: 200 });
    }

    if (!matchedEvents || matchedEvents.length === 0) {
      // Capture the payment into the unmatched inbox so the operator can
      // route it (e.g. catering deposit for a future event, remainder
      // payment for a past event). See migration 20260424000001 for the
      // full rationale.
      const { error: insertError } = await supabase
        .from("unmatched_toast_payments")
        .insert({
          user_id: userId,
          source: "toast",
          reported_date: parsed.date,
          net_sales: parsed.netSales,
          raw_subject: rawSubject,
        });

      if (insertError) {
        // Fall back to pre-inbox behavior — log it and move on. Don't
        // fail the webhook over an inbox insert problem.
        console.error(`[toast/inbound] Inbox insert failed for user ${userId}:`, insertError);
      } else {
        console.log(`[toast/inbound] Queued for review: user ${userId}, ${parsed.date}, $${parsed.netSales}`);
      }

      await recordSyncAttempt(
        supabase,
        userId,
        "queued_for_review",
        `Toast reported $${parsed.netSales.toFixed(2)} on ${parsed.date} with no booked event. Queued for manual review in your integrations inbox.`
      );
      return NextResponse.json({ ok: true, reason: "queued_for_review", date: parsed.date }, { status: 200 });
    }

    if (matchedEvents.length > 1) {
      console.log(`[toast/inbound] Ambiguous: ${matchedEvents.length} events for user ${userId} on ${parsed.date}`);
      await recordSyncAttempt(
        supabase,
        userId,
        "ambiguous_match",
        `${matchedEvents.length} booked events on ${parsed.date}; pick the right one manually and log sales.`
      );
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
      await recordSyncAttempt(supabase, userId, "update_failed", updateError.message);
      return NextResponse.json({ ok: false, reason: "update_failed" }, { status: 200 });
    }

    await recordSyncAttempt(supabase, userId, "success", null);

    await recalculateForUserWithClient(userId, supabase);

    console.log(`[toast/inbound] Synced $${parsed.netSales} to "${event.event_name}" for user ${userId}`);
    return NextResponse.json(
      { ok: true, eventId: event.id, eventName: event.event_name, netSales: parsed.netSales },
      { status: 200 }
    );
  } catch (err) {
    console.error("[toast/inbound] Unexpected error:", err);
    // If we got far enough to know who this email belongs to, surface
    // the error in the UI via pos_connections. If not (threw before
    // user lookup), best we can do is console; the stale-sync
    // diagnostic will catch the silence over time.
    if (supabase && userId) {
      await recordSyncAttempt(
        supabase,
        userId,
        "internal_error",
        err instanceof Error ? err.message : String(err)
      );
    }
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 200 });
  }
}
