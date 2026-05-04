import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/event-names/search?q=...
 *
 * Returns up to 8 canonical event-name suggestions for the
 * EventForm typeahead. Sourced from platform_events.event_name_display
 * — the original casing/spacing the first operator who created the
 * bucket typed.
 *
 * Why this exists: the platform_events bucket key is
 * eventName.toLowerCase().trim() (see platform-registry.ts:303), so
 * "Saturday Farmer's Market" / "Saturday Farmers Market" /
 * "Saturday Farmers Market 2026" all create separate buckets and
 * never hit the privacy floor for the cross-operator hint. This
 * endpoint is the cheap UX nudge — when an operator types "Sat", we
 * show them the canonical names other operators have used so they
 * pick the one that's already shared rather than typing a near-miss
 * variant.
 *
 * Pure read, no mutations. Auth required so we don't leak event_name
 * lists to the public web — RLS already restricts platform_events
 * reads to authenticated users; this just makes that explicit.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    // Below 2 chars the result list dominates the UI without adding
    // signal — let the field render plainly.
    return NextResponse.json({ suggestions: [] });
  }

  // ilike on the normalized form (lowercase + trimmed) since the user's
  // query is going to be casual case. % wildcards on both sides because
  // "farmer" should match "Saturday Farmers Market." Cap at 8 — enough
  // to cover same-day variants without scrolling. Sort by operator_count
  // desc so the most-shared bucket floats up: that's the one we want
  // future operators to converge on.
  const { data, error } = await supabase
    .from("platform_events")
    .select("event_name_display, operator_count")
    .ilike("event_name_normalized", `%${q.toLowerCase()}%`)
    .order("operator_count", { ascending: false })
    .limit(8);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const suggestions = (data ?? []).map(
    (row: { event_name_display: string; operator_count: number }) => ({
      name: row.event_name_display,
      operator_count: row.operator_count,
    })
  );

  return NextResponse.json({ suggestions });
}
