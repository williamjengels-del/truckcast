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

  // Also clear sample inquiries — matched on the operator's UUID
  // being in matched_operator_ids AND is_sample=true so we never
  // touch real inquiry rows that happen to be in this user's inbox.
  // Note the contains() filter scopes the WHERE before is_sample
  // does, but Postgres + RLS evaluate both anyway — belt-and-
  // suspenders.
  const { error: inquiriesError } = await supabase
    .from("event_inquiries")
    .delete()
    .contains("matched_operator_ids", [user.id])
    .eq("is_sample", true);
  if (inquiriesError) {
    console.error("[sample-data/clear] inquiries delete failed:", inquiriesError.message);
  }

  // Sample contacts — scoped by user_id + is_sample. Same pattern.
  const { error: contactsError } = await supabase
    .from("contacts")
    .delete()
    .eq("user_id", user.id)
    .eq("is_sample", true);
  if (contactsError) {
    console.error("[sample-data/clear] contacts delete failed:", contactsError.message);
  }

  return NextResponse.json({ ok: true, deleted: priorCount ?? 0 });
}
