import { NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

/**
 * GET /api/dashboard/inquiries
 *
 * Returns event_inquiries where the current dashboard scope's userId
 * appears in matched_operator_ids. RLS already enforces this scope at
 * the row level (per migration 20260502000006); the explicit filter is
 * belt-and-suspenders + lets us order/limit cleanly.
 *
 * Used by /dashboard/inquiries page.
 */

export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull all open + recently-closed inquiries for this operator. Cap
  // at 100 (operators with that many inquiries should ping us — they're
  // not the v1 audience).
  const { data, error } = await scope.client
    .from("event_inquiries")
    .select("*")
    .contains("matched_operator_ids", [scope.userId])
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inquiries: data ?? [] });
}
