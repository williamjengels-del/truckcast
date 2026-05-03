import { NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

// GET /api/dashboard/sidebar-state
//
// Composite endpoint returning the four fields the sidebar + mobile
// nav both need:
//   { subscription_tier, is_manager, unlogged_count, open_inquiry_count }
// Consumed by:
//   src/components/sidebar.tsx
//   src/components/mobile-nav.tsx
//
// Deliberately aggregated (not split into /profile + /events/unlogged)
// because the unlogged count requires pulling + filtering a bounded
// event list, and we don't want to ship that payload across the wire
// just for the client to derive a single number. Server-side filter,
// single number back.
//
// Filter rules for the "unlogged events" count — mirrors the Needs
// Attention tab shown inside the Events page:
//
//   booked = true
//   net_sales IS NULL
//   cancellation_reason IS NULL
//   fee_type != 'pre_settled'
//   event_date < today (in ISO YYYY-MM-DD)
//   AND NOT (event_mode = 'catering' AND invoice_revenue > 0)
//   AND anomaly_flag != 'disrupted'
//
// The last two filters involve either a compound condition or a
// catering/invoice-revenue relationship that's awkward in PostgREST —
// apply them in TS after fetching a minimal column set. The inline
// filter in sidebar.tsx uses the same rule; see that file for the
// authoritative definition.

interface UnloggedRow {
  id: string;
  event_mode: string | null;
  invoice_revenue: number | null;
  anomaly_flag: string | null;
  cancellation_reason: string | null;
}

// Open inquiry = matched to this operator, status open, and this user
// hasn't acted on it yet (no entry under operator_actions[userId]).
// Same predicate as the inbox's default "Open" filter, surfaced as a
// badge so operators see new inquiries without opening the page.
interface InquiryActionRow {
  id: string;
  status: string;
  operator_actions: Record<string, { action: string }> | null;
}

export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];

  const [profileRes, unloggedRes, inquiriesRes] = await Promise.all([
    scope.client
      .from("profiles")
      .select("subscription_tier, owner_user_id")
      .eq("id", scope.userId)
      .maybeSingle(),
    scope.client
      .from("events")
      .select("id, event_mode, invoice_revenue, anomaly_flag, cancellation_reason")
      .eq("user_id", scope.userId)
      .eq("booked", true)
      .is("net_sales", null)
      .is("cancellation_reason", null)
      .neq("fee_type", "pre_settled")
      .lt("event_date", today),
    scope.client
      .from("event_inquiries")
      .select("id, status, operator_actions")
      .contains("matched_operator_ids", [scope.userId])
      .eq("status", "open"),
  ]);

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }
  if (unloggedRes.error) {
    return NextResponse.json({ error: unloggedRes.error.message }, { status: 500 });
  }
  // inquiriesRes.error is intentionally non-fatal — sidebar should
  // still render if event_inquiries has a hiccup. Surface 0 instead.

  const profile = profileRes.data as
    | { subscription_tier: string | null; owner_user_id: string | null }
    | null;

  const unloggedRows = (unloggedRes.data ?? []) as UnloggedRow[];
  const unlogged_count = unloggedRows.filter(
    (e) =>
      !(e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0) &&
      e.anomaly_flag !== "disrupted"
  ).length;

  const inquiryRows = (inquiriesRes.data ?? []) as InquiryActionRow[];
  const open_inquiry_count = inquiryRows.filter(
    (i) => !i.operator_actions?.[scope.userId]
  ).length;

  return NextResponse.json({
    subscription_tier: profile?.subscription_tier ?? "starter",
    is_manager: !!profile?.owner_user_id,
    unlogged_count,
    open_inquiry_count,
  });
}
