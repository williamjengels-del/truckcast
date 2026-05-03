import { NextRequest, NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

/**
 * POST /api/event-inquiries/action
 *
 * Records an operator's action against an inquiry. Stored in the
 * inquiry's operator_actions jsonb keyed by the operator's UUID.
 *
 * Body: { inquiryId: string, action: "claimed" | "declined" | "contacted" }
 *
 * Atomic per-operator update via jsonb_set wouldn't be safe under
 * concurrent updates from the same operator — use SELECT-then-UPDATE
 * with the operator-specific RLS policy gating writes (operator can
 * only update inquiries they're matched to).
 *
 * No "unaction" path in v1 — operators can't undo a decline. Future
 * could add that as a Reset button, but for v1 keep it simple.
 */

const VALID_ACTIONS = new Set(["claimed", "declined", "contacted"]);

export async function POST(req: NextRequest) {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const r = body as Record<string, unknown>;
  const inquiryId = typeof r.inquiryId === "string" ? r.inquiryId : null;
  const action = typeof r.action === "string" ? r.action : null;
  if (!inquiryId || !action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "inquiryId + valid action required (claimed / declined / contacted)" },
      { status: 400 }
    );
  }

  // Read the inquiry (RLS scopes to matched operators only).
  const { data: inquiry, error: readError } = await scope.client
    .from("event_inquiries")
    .select("operator_actions")
    .eq("id", inquiryId)
    .maybeSingle();
  if (readError || !inquiry) {
    return NextResponse.json(
      { error: readError?.message ?? "Inquiry not found or not accessible" },
      { status: 404 }
    );
  }

  // Merge the operator's action into the jsonb. Single-operator UPDATE
  // is safe — RLS already prevents other operators from touching this
  // operator's slot.
  const existing = (inquiry.operator_actions ?? {}) as Record<string, unknown>;
  const updated = {
    ...existing,
    [scope.userId]: {
      action,
      at: new Date().toISOString(),
    },
  };

  const { error: writeError } = await scope.client
    .from("event_inquiries")
    .update({ operator_actions: updated })
    .eq("id", inquiryId);

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  // On claim, auto-create a planning event pre-filled from the inquiry.
  // Booked=false because Claim is "I want this lead" not "deal closed" —
  // the operator confirms separately with the organizer. Idempotent via
  // the unique index on (user_id, source_inquiry_id) plus an explicit
  // pre-check, so re-clicking Claim is a no-op that returns the
  // existing event id.
  let eventId: string | undefined;
  if (action === "claimed") {
    eventId = await ensureEventForClaim(scope.client, scope.userId, inquiryId);
  }

  return NextResponse.json({ ok: true, eventId });
}

async function ensureEventForClaim(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string,
  inquiryId: string
): Promise<string | undefined> {
  // Pre-check: did this user already create an event from this inquiry?
  const { data: existing } = await client
    .from("events")
    .select("id")
    .eq("user_id", userId)
    .eq("source_inquiry_id", inquiryId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  // Pull just the fields the events row needs. RLS allows the read
  // because this user is in matched_operator_ids (they wouldn't have
  // gotten here otherwise — the action route's earlier read already
  // validated that).
  const { data: inquiry, error: readError } = await client
    .from("event_inquiries")
    .select(
      "event_name, event_date, event_start_time, event_end_time, event_type, expected_attendance, city, location_details, organizer_name, organizer_email, organizer_phone, notes"
    )
    .eq("id", inquiryId)
    .maybeSingle();
  if (readError || !inquiry) return undefined;

  // event_name fallback: organizer name + event type makes the row
  // readable in the events list before the operator edits it.
  const eventName =
    (inquiry.event_name as string | null) ??
    `${inquiry.event_type} for ${inquiry.organizer_name}`;

  // Stitch organizer contact into notes so the operator has it on the
  // event row without having to bounce back to the inbox. Original
  // organizer notes lead, contact block follows.
  const contactLines = [
    `— Source: marketplace inquiry`,
    `— Organizer: ${inquiry.organizer_name} <${inquiry.organizer_email}>`,
  ];
  if (inquiry.organizer_phone) {
    contactLines.push(`— Phone: ${inquiry.organizer_phone}`);
  }
  const stitchedNotes = [
    inquiry.notes ? String(inquiry.notes).trim() : null,
    contactLines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data: inserted, error: insertError } = await client
    .from("events")
    .insert({
      user_id: userId,
      event_name: eventName,
      event_date: inquiry.event_date,
      start_time: inquiry.event_start_time,
      end_time: inquiry.event_end_time,
      event_type: inquiry.event_type,
      expected_attendance: inquiry.expected_attendance,
      city: inquiry.city,
      location: inquiry.location_details,
      notes: stitchedNotes,
      booked: false,
      source_inquiry_id: inquiryId,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return inserted.id as string;
  }

  // Race-safe fallback: if the unique index trips because a parallel
  // request just inserted, refetch and return that one. Postgres
  // unique-violation error code is 23505.
  if ((insertError as { code?: string } | null)?.code === "23505") {
    const { data: existingAfterRace } = await client
      .from("events")
      .select("id")
      .eq("user_id", userId)
      .eq("source_inquiry_id", inquiryId)
      .maybeSingle();
    if (existingAfterRace?.id) return existingAfterRace.id as string;
  }

  // Insert failed for some other reason — don't fail the whole action
  // (operator_actions is the source of truth for "I claimed this"), just
  // surface no eventId in the response. Logged for follow-up.
  console.error(
    `[event-inquiries/action] auto-create event failed for user=${userId} inquiry=${inquiryId}:`,
    insertError?.message ?? "unknown"
  );
  return undefined;
}
