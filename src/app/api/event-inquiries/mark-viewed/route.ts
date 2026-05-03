import { NextRequest, NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

/**
 * POST /api/event-inquiries/mark-viewed
 *
 * Bulk-stamps `viewed_at` onto each inquiry's operator_actions slot for
 * the current operator. Called by the inbox via IntersectionObserver
 * when an inquiry card crosses into the viewport, so passive scrolling
 * counts as "the operator saw this" without requiring a click.
 *
 * Body: { inquiryIds: string[] }
 *
 * Idempotent: if a slot already has viewed_at, the existing timestamp
 * is preserved (we only stamp first-view, not most-recent-view). Action
 * fields (action / at) are preserved untouched.
 *
 * RLS gates writes — the operator must be in the inquiry's
 * matched_operator_ids to update the row, mirroring the action route.
 */
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
  const inquiryIds = Array.isArray(r?.inquiryIds)
    ? (r.inquiryIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  if (inquiryIds.length === 0) {
    return NextResponse.json({ ok: true, marked: 0 });
  }
  // Cap to a sane batch size — IntersectionObserver shouldn't fire
  // more than a few dozen at once, but defensive against a runaway
  // client.
  const capped = inquiryIds.slice(0, 100);

  // Read the current operator_actions for each, then merge viewed_at
  // only where it's missing. Bulk-update could clobber concurrent
  // action writes, so keep the SELECT-then-UPDATE-each shape — the
  // caller already batches into one HTTP round trip.
  const { data: existing, error: readError } = await scope.client
    .from("event_inquiries")
    .select("id, operator_actions")
    .in("id", capped);

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  let marked = 0;

  for (const row of existing ?? []) {
    const r2 = row as { id: string; operator_actions: Record<string, unknown> | null };
    const actions = (r2.operator_actions ?? {}) as Record<string, Record<string, unknown>>;
    const slot = actions[scope.userId] ?? {};
    if (slot.viewed_at) continue; // Idempotent — keep first-view timestamp
    const updated = {
      ...actions,
      [scope.userId]: { ...slot, viewed_at: nowIso },
    };
    const { error: writeError } = await scope.client
      .from("event_inquiries")
      .update({ operator_actions: updated })
      .eq("id", r2.id);
    if (!writeError) marked += 1;
  }

  return NextResponse.json({ ok: true, marked });
}
