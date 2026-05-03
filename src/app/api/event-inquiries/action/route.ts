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

  return NextResponse.json({ ok: true });
}
