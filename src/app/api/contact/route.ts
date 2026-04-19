import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendContactFormEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

// POST /api/contact
//
// Public endpoint — no auth required, but prefills if authenticated.
// Validates → checks honeypot → rate limits → sends email via Resend.
//
// Per Julian's spec: we do NOT store submissions in the database.
// Email is the record. If abuse requires retention, upgrade to a
// Supabase-backed audit log (new table + API extension).

const VALID_SUBJECTS = [
  "General question",
  "Bug report",
  "Feature request",
  "Billing question",
  "Other",
];

// 3 submissions per 10 minutes per IP. Honeypot is the primary bot
// defense; this catches single-instance hammer attacks. See
// src/lib/rate-limit.ts for the caveat about Vercel's multi-instance
// model (in-memory state not shared across regions).
const RATE_LIMIT_COUNT = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

interface ContactRequestBody {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  /** Honeypot — MUST be empty. Bots fill it; humans don't see it. */
  website?: string;
}

export async function POST(request: NextRequest) {
  let body: ContactRequestBody;
  try {
    body = (await request.json()) as ContactRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  // ── Honeypot ──
  // Bots fill hidden fields. Return 200 OK (pretend success) so bots
  // don't learn they've been caught and iterate on the form. Humans
  // never hit this branch because the field is visually hidden.
  if (body.website && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // ── Input validation (server-side, mirrors client validation) ──
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!name || name.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Name is required." },
      { status: 400 }
    );
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return NextResponse.json(
      { ok: false, error: "A valid email is required." },
      { status: 400 }
    );
  }
  if (!VALID_SUBJECTS.includes(subject)) {
    return NextResponse.json(
      { ok: false, error: "Please choose a subject." },
      { status: 400 }
    );
  }
  if (message.length < 10 || message.length > 2000) {
    return NextResponse.json(
      { ok: false, error: "Message must be between 10 and 2000 characters." },
      { status: 400 }
    );
  }

  // ── Rate limit ──
  // x-forwarded-for is the Vercel-set client IP header. Falls back to
  // x-real-ip, then a literal "unknown" bucket so submissions without
  // either header still get rate-limited (shared bucket across all
  // such requests — conservative by design).
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip =
    (forwardedFor ? forwardedFor.split(",")[0].trim() : null) ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const allowed = checkRateLimit(ip, RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many submissions. Please try again in a few minutes.",
      },
      { status: 429 }
    );
  }

  // ── Gather context for the email body ──
  // user_id from the Supabase session if present (best-effort; contact
  // form is public). Not used to authorize — just helps Julian see
  // whether the submitter has an account.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }

  const userAgent = request.headers.get("user-agent");

  const now = new Date();
  const submittedAt = now.toISOString();
  // Dual-format timestamp per Julian's spec: UTC is unambiguous for
  // logs, Central is his working timezone. e.g.
  // "Apr 20, 2026, 1:32 PM CDT"
  const submittedAtCentral = now.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // ── Send the email ──
  try {
    await sendContactFormEmail({
      name,
      email,
      subject,
      message,
      userId,
      ip,
      userAgent,
      submittedAt,
      submittedAtCentral,
    });
  } catch (err) {
    console.error("contact_form_send_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Couldn't send right now. Please try again shortly.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
