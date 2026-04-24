import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/pos/toast/unmatched
 *
 * List unresolved unmatched_toast_payments for the current user, newest
 * first. Backing query uses the partial index on (user_id, created_at
 * desc) WHERE resolved_at IS NULL so this is cheap even with a lot of
 * historical resolved rows.
 *
 * No pagination today — an operator's unresolved queue should be small.
 * Add limit/offset when we see one get larger than ~50.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("unmatched_toast_payments")
    .select("id, source, reported_date, net_sales, raw_subject, created_at")
    .eq("user_id", user.id)
    .is("resolved_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[toast/unmatched] list failed:", error);
    return NextResponse.json({ error: "Failed to load unmatched payments" }, { status: 500 });
  }

  return NextResponse.json({ payments: data ?? [] });
}
