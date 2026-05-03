import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/sample-data/clear
 *
 * Deletes all events with is_sample=true for the calling operator.
 * Safe to call repeatedly — no-op if nothing matches. Operator's REAL
 * events are untouched (the WHERE is_sample=true predicate excludes
 * them by design).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // head:true so we get the count without pulling rows.
  const { count: priorCount } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_sample", true);

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("user_id", user.id)
    .eq("is_sample", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: priorCount ?? 0 });
}
