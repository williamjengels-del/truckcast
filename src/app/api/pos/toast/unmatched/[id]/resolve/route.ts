import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recalculateForUserWithClient } from "@/lib/recalculate-service";
import type { Event, UnmatchedToastPayment } from "@/lib/database.types";

/**
 * POST /api/pos/toast/unmatched/[id]/resolve
 *
 * Body: { action: "assign_to_event", eventId: string }
 *   OR: { action: "dismiss" }
 *
 * assign_to_event:
 *   - Adds the unmatched payment's net_sales to the target event. For
 *     catering events, that means adding to `invoice_revenue` (since
 *     catering uses invoice_revenue + net_sales separately per the
 *     event model). For vending / food_truck events, it adds to
 *     `net_sales`. Both branches handle NULL prior values as zero.
 *   - Marks the payment row resolved with resolved_event_id pointing
 *     at the target.
 *   - Kicks recalculateForUserWithClient so forecasts refresh.
 *
 * dismiss:
 *   - Marks the payment row resolved with action=dismissed, no event
 *     touched. Use this for duplicate reports, parse noise, or
 *     payments the operator decided not to attribute to anything.
 *
 * Auth: must be the user who owns the unmatched payment row (enforced
 * via RLS on select + update; we also re-check defensively).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; eventId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, eventId } = body;
  if (action !== "assign_to_event" && action !== "dismiss") {
    return NextResponse.json(
      { error: `Invalid action "${action}"; must be "assign_to_event" or "dismiss"` },
      { status: 400 }
    );
  }
  if (action === "assign_to_event" && !eventId) {
    return NextResponse.json(
      { error: "eventId is required when action is assign_to_event" },
      { status: 400 }
    );
  }

  // Re-fetch the payment row so we can validate it's (a) owned by the
  // caller and (b) not already resolved. RLS would also block
  // cross-user access but we want a clean error message.
  const { data: paymentRow, error: paymentError } = await supabase
    .from("unmatched_toast_payments")
    .select("*")
    .eq("id", id)
    .single();

  if (paymentError || !paymentRow) {
    return NextResponse.json({ error: "Unmatched payment not found" }, { status: 404 });
  }
  const payment = paymentRow as UnmatchedToastPayment;

  if (payment.user_id !== user.id) {
    return NextResponse.json({ error: "Unmatched payment not found" }, { status: 404 });
  }
  if (payment.resolved_at) {
    return NextResponse.json(
      { error: "Already resolved" },
      { status: 409 }
    );
  }

  if (action === "dismiss") {
    const { error: dismissError } = await supabase
      .from("unmatched_toast_payments")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_action: "dismissed",
        resolved_by_user_id: user.id,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (dismissError) {
      console.error("[toast/unmatched/resolve] dismiss failed:", dismissError);
      return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, resolved: "dismissed" });
  }

  // action === "assign_to_event"
  // Fetch the target event to validate ownership + pick the right
  // amount column to update (catering vs food_truck).
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("id, user_id, event_mode, net_sales, invoice_revenue, event_name")
    .eq("id", eventId as string)
    .single();

  if (eventError || !eventRow) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const target = eventRow as Pick<Event, "id" | "user_id" | "event_mode" | "net_sales" | "invoice_revenue" | "event_name">;

  if (target.user_id !== user.id) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // pos-13: refuse the assignment when event_mode is NULL. Pre-fix, the
  // ?? "food_truck" fallback silently routed catering payments to
  // net_sales — invisible misclassification that broke catering revenue
  // forecasting. Fail loud so the operator sets the mode explicitly
  // before assigning.
  if (target.event_mode === null || target.event_mode === undefined) {
    return NextResponse.json(
      {
        error: "Event mode not set",
        detail:
          `Set the event mode (food truck / catering) on "${target.event_name}" before assigning a Toast payment to it. ` +
          `Without that, we can't tell whether the payment is sales (net_sales) or invoice revenue.`,
        code: "event_mode_missing",
      },
      { status: 422 }
    );
  }

  // For catering events the payment represents invoice revenue (deposit
  // or remainder). For food_truck / vending events, it's sales. Both
  // add on top of whatever's already there so multiple partial payments
  // stack correctly.
  const isCatering = target.event_mode === "catering";
  const columnToBump = isCatering ? "invoice_revenue" : "net_sales";
  const priorValue = Number(
    (isCatering ? target.invoice_revenue : target.net_sales) ?? 0
  );
  const newValue = priorValue + Number(payment.net_sales);

  // race-5/pos-4: claim the payment row FIRST with a conditional update
  // (resolved_at IS NULL), then bump the event. Pre-fix order was
  // bump-then-claim, which let two concurrent requests both pass the
  // resolved-check at line 80, both bump (potentially different) events,
  // and both win the claim race — same payment routed to two events,
  // permanent double-count.
  //
  // Post-fix: only one request can claim because PostgreSQL row-locks
  // the UPDATE; the loser sees rowcount=0 and 409s. The bump-then-
  // rollback path below handles the failure-mode where we claim but
  // then fail to bump (best-effort rollback + loud log).
  const { data: claimedRows, error: claimError } = await supabase
    .from("unmatched_toast_payments")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_action: "assigned_to_event",
      resolved_event_id: target.id,
      resolved_by_user_id: user.id,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("resolved_at", null)
    .select("id");

  if (claimError) {
    console.error("[toast/unmatched/resolve] claim failed:", claimError);
    return NextResponse.json({ error: "Failed to claim payment" }, { status: 500 });
  }

  if (!claimedRows || claimedRows.length === 0) {
    // Another concurrent request claimed this payment first — could be
    // a double-click on the same event, or the operator clicking
    // assign-to-different-event in two tabs. Either way, surface the
    // conflict so the operator can refresh.
    return NextResponse.json(
      {
        error: "Already resolved",
        detail: "This payment was just resolved by another request. Refresh the inbox to see the current state.",
      },
      { status: 409 }
    );
  }

  // We hold the claim. Bump the event.
  const { error: eventUpdateError } = await supabase
    .from("events")
    .update({
      [columnToBump]: newValue,
      pos_source: "toast",
    })
    .eq("id", target.id)
    .eq("user_id", user.id);

  if (eventUpdateError) {
    // Bump failed after claim succeeded — best-effort rollback. If the
    // rollback itself fails, we end up with payment marked resolved
    // but event not bumped — same risk surface as the prior code's
    // CRITICAL log path, just on the other side of the ordering.
    console.error("[toast/unmatched/resolve] event update failed:", eventUpdateError);
    const { error: rollbackError } = await supabase
      .from("unmatched_toast_payments")
      .update({
        resolved_at: null,
        resolved_action: null,
        resolved_event_id: null,
        resolved_by_user_id: null,
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (rollbackError) {
      console.error(
        "[toast/unmatched/resolve] CRITICAL: bump failed AND rollback failed — payment is marked resolved but event was not updated. Manual cleanup required.",
        { paymentId: id, eventId: target.id, priorValue, newValue, rollbackError }
      );
    }
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }

  // Recompute forecasts since event sales changed.
  await recalculateForUserWithClient(user.id, supabase);

  return NextResponse.json({
    ok: true,
    resolved: "assigned_to_event",
    eventId: target.id,
    eventName: target.event_name,
    column: columnToBump,
    priorValue,
    newValue,
  });
}
