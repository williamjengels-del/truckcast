import { NextRequest, NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

/**
 * POST /api/event-inquiries/notes
 *
 * Updates the calling operator's per-inquiry private note. Stored in
 * event_inquiries.operator_notes_by_user keyed by user_id so a single
 * inquiry can carry distinct notes from each matched operator without
 * leaking across operators.
 *
 * Body: { inquiryId: string, notes: string }
 *
 * Empty / whitespace-only notes are pruned (delete the slot rather
 * than store ""). Caps at 4000 chars — practical limit for a sticky-
 * note style field; if operators need more they should use a CRM.
 *
 * SELECT-then-UPDATE because Supabase doesn't offer a server-side
 * jsonb merge operator binding. Race-tolerant: at v1 marketplace
 * density an operator overwriting their own notes from two tabs is
 * the expected mode and the last-write-wins behavior is correct.
 */
const NOTES_MAX = 4000;

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
  const r = body as Record<string, unknown> | null;
  const inquiryId = typeof r?.inquiryId === "string" ? r.inquiryId : null;
  const notesRaw = typeof r?.notes === "string" ? r.notes : null;
  if (!inquiryId || notesRaw === null) {
    return NextResponse.json(
      { error: "inquiryId + notes required" },
      { status: 400 }
    );
  }
  const notes = notesRaw.slice(0, NOTES_MAX).trim();

  const { data: existing, error: readError } = await scope.client
    .from("event_inquiries")
    .select("operator_notes_by_user")
    .eq("id", inquiryId)
    .maybeSingle();
  if (readError || !existing) {
    return NextResponse.json(
      { error: readError?.message ?? "Inquiry not accessible" },
      { status: 404 }
    );
  }

  const current = (existing.operator_notes_by_user ?? {}) as Record<string, string>;
  const next = { ...current };
  if (notes === "") {
    delete next[scope.userId];
  } else {
    next[scope.userId] = notes;
  }

  const { error: writeError } = await scope.client
    .from("event_inquiries")
    .update({ operator_notes_by_user: next })
    .eq("id", inquiryId);

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
