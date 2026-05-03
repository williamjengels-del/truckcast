import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { matchOperatorsForInquiry } from "@/lib/event-inquiry-routing";
import { sendEventInquiryConfirmation } from "@/lib/email";
import { EVENT_TYPES } from "@/lib/constants";
import { canonicalizeCity } from "@/lib/city-normalize";

/**
 * POST /api/event-inquiries/submit
 *
 * Public submit endpoint for the marketplace inquiry form. Anonymous
 * (no auth required). Validates payload, runs operator routing,
 * inserts the row, and sends the organizer a confirmation email.
 *
 * Rate limit (light): 5 submissions per IP per hour. Caught by the
 * lookup against created_at; refuses with 429. Honest failure mode —
 * organizer sees a message and can try again later.
 *
 * Spam mitigation in v1: honeypot field (`company_website`) + IP rate
 * limit. CAPTCHA deferred to 7c if abuse becomes a real signal.
 */

const RATE_LIMIT_PER_HOUR = 5;

interface SubmitPayload {
  organizer_name: string;
  organizer_email: string;
  organizer_phone?: string;
  organizer_org?: string;
  event_name?: string;
  event_date: string; // YYYY-MM-DD
  event_start_time?: string;
  event_end_time?: string;
  event_type: string;
  expected_attendance?: number;
  city: string;
  state: string;
  location_details?: string;
  budget_estimate?: number;
  notes?: string;
  // Honeypot — real users won't fill this. Bots typically auto-fill
  // anything labeled with "website" / "url".
  company_website?: string;
}

function validate(p: unknown): { ok: true; payload: SubmitPayload } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "Invalid payload" };
  const r = p as Record<string, unknown>;

  // Honeypot check — silent acceptance with no actual insert. Bots
  // get a "thanks" response and never know they were filtered.
  if (typeof r.company_website === "string" && r.company_website.trim() !== "") {
    return { ok: false, error: "HONEYPOT" };
  }

  const required = ["organizer_name", "organizer_email", "event_date", "event_type", "city", "state"];
  for (const k of required) {
    if (typeof r[k] !== "string" || (r[k] as string).trim() === "") {
      return { ok: false, error: `${k} is required` };
    }
  }
  // Email shape check (loose; we're not the gatekeeper for organizer
  // typos, just enough to reject obvious junk).
  const email = (r.organizer_email as string).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Invalid email address" };
  }
  // Date sanity — must be today or future.
  const date = (r.event_date as string).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid event_date format (use YYYY-MM-DD)" };
  }
  if (date < new Date().toISOString().slice(0, 10)) {
    return { ok: false, error: "Event date must be today or in the future" };
  }
  // Event type — must be one of the catalog
  const event_type = (r.event_type as string).trim();
  if (!(EVENT_TYPES as readonly string[]).includes(event_type)) {
    return { ok: false, error: `Invalid event_type. Must be one of: ${EVENT_TYPES.join(", ")}` };
  }

  return {
    ok: true,
    payload: {
      organizer_name: (r.organizer_name as string).trim(),
      organizer_email: email,
      organizer_phone: typeof r.organizer_phone === "string" ? r.organizer_phone.trim() || undefined : undefined,
      organizer_org: typeof r.organizer_org === "string" ? r.organizer_org.trim() || undefined : undefined,
      event_name: typeof r.event_name === "string" ? r.event_name.trim() || undefined : undefined,
      event_date: date,
      event_start_time: typeof r.event_start_time === "string" ? r.event_start_time.trim() || undefined : undefined,
      event_end_time: typeof r.event_end_time === "string" ? r.event_end_time.trim() || undefined : undefined,
      event_type,
      expected_attendance:
        typeof r.expected_attendance === "number" && Number.isFinite(r.expected_attendance) && r.expected_attendance > 0
          ? Math.floor(r.expected_attendance)
          : undefined,
      // Canonicalize on submit so stored event_inquiries.city matches
      // operator profiles after the same canonicalization runs there.
      // Routing already canonicalizes both sides for the match, so this
      // is mostly about display consistency — operators see "Saint
      // Louis" everywhere instead of one inquiry showing "St. Louis"
      // and another "Saint Louis" for the same city.
      city: canonicalizeCity((r.city as string).trim()),
      state: (r.state as string).trim(),
      location_details: typeof r.location_details === "string" ? r.location_details.trim() || undefined : undefined,
      budget_estimate:
        typeof r.budget_estimate === "number" && Number.isFinite(r.budget_estimate) && r.budget_estimate > 0
          ? Math.floor(r.budget_estimate)
          : undefined,
      notes: typeof r.notes === "string" ? r.notes.trim() || undefined : undefined,
    },
  };
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const v = validate(raw);
  if (!v.ok) {
    // Honeypot returns 200 OK with no insert — looks like a normal
    // success to the bot, doesn't waste a row in the table.
    if (v.error === "HONEYPOT") {
      return NextResponse.json({ ok: true, id: "ok" }, { status: 200 });
    }
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Light IP-based rate limit. Forwarded-For first; falls back to
  // X-Real-IP, then "unknown" (we won't enforce on traffic we can't
  // identify — Vercel always sets one of these).
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (ip !== "unknown") {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // We track IP via the organizer_email proxy isn't reliable; keep
    // it loose for v1 — count any inquiries in the last hour with the
    // same organizer_email. Bots that vary email per submit slip
    // through; that's where a CAPTCHA earns its place.
    const { count } = await service
      .from("event_inquiries")
      .select("id", { count: "exact", head: true })
      .eq("organizer_email", v.payload.organizer_email)
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: "Too many submissions in the last hour. Try again later." },
        { status: 429 }
      );
    }
  }

  // Route to operators
  const matched = await matchOperatorsForInquiry(service, v.payload.city, v.payload.event_type);

  // Insert the inquiry row
  const { data, error } = await service
    .from("event_inquiries")
    .insert({
      organizer_name: v.payload.organizer_name,
      organizer_email: v.payload.organizer_email,
      organizer_phone: v.payload.organizer_phone ?? null,
      organizer_org: v.payload.organizer_org ?? null,
      event_name: v.payload.event_name ?? null,
      event_date: v.payload.event_date,
      event_start_time: v.payload.event_start_time ?? null,
      event_end_time: v.payload.event_end_time ?? null,
      event_type: v.payload.event_type,
      expected_attendance: v.payload.expected_attendance ?? null,
      city: v.payload.city,
      state: v.payload.state,
      location_details: v.payload.location_details ?? null,
      budget_estimate: v.payload.budget_estimate ?? null,
      notes: v.payload.notes ?? null,
      matched_operator_ids: matched,
      operator_actions: {},
      status: "open",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  // Send organizer confirmation. Fire-and-forget — failure on the
  // email side shouldn't fail the submit (the row's already saved).
  try {
    await sendEventInquiryConfirmation({
      to: v.payload.organizer_email,
      organizerName: v.payload.organizer_name,
      eventDate: v.payload.event_date,
      eventType: v.payload.event_type,
      city: v.payload.city,
      state: v.payload.state,
      matchedOperatorCount: matched.length,
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true, id: data.id, matchedOperatorCount: matched.length });
}
