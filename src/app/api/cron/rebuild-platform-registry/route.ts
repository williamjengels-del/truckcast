import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertCronSecret } from "@/lib/cron-auth";
import { updatePlatformRegistry } from "@/lib/platform-registry";

/**
 * GET /api/cron/rebuild-platform-registry
 *
 * Nightly full rebuild of the platform_events cache. The cache drifts
 * out of sync because updatePlatformRegistry() only fires for the
 * event_names a single operator just recalc'd — buckets where the
 * contributing events have been deleted, disrupted, or had their
 * data_sharing flag flipped don't get refreshed otherwise.
 *
 * The live read-path (getPlatformEventsExcludingUser) is authoritative
 * for the forecast engine, so stale cache doesn't affect forecasts.
 * But the cache misleads anything that reads it directly (admin views,
 * diagnostics, dashboard summaries). This route realigns it.
 *
 * What it does:
 *   1. Enumerates every distinct event_name across all sharing-enabled
 *      top-level operators with at least one eligible row.
 *   2. Hands the full list to updatePlatformRegistry(), which recomputes
 *      each bucket and deletes rows where backing data has vanished.
 *
 * Schedule (vercel.json): 4:00 UTC daily = 23:00 Central. Runs after
 * the trial-emails / weekly-digest cron windows so it doesn't compete
 * for the same Supabase capacity.
 *
 * Auth via CRON_SECRET — same pattern as the other cron routes.
 *
 * Idempotent — re-running has the same end state. Safe to retry on
 * failure.
 */
export async function GET(req: NextRequest) {
  const authError = assertCronSecret(req);
  if (authError) return authError;

  const SUPABASE_URL =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing Supabase env vars" },
      { status: 500 }
    );
  }
  const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Top-level sharing operators.
  const { data: sharingUsers, error: profErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  if (profErr) {
    return NextResponse.json(
      { error: "profiles fetch failed", detail: profErr.message },
      { status: 500 }
    );
  }
  const sharingIds = ((sharingUsers ?? []) as { id: string }[]).map((u) => u.id);
  if (sharingIds.length === 0) {
    return NextResponse.json({
      ok: true,
      sharing_operators: 0,
      event_names: 0,
      elapsed_ms: 0,
      note: "no sharing operators — nothing to rebuild",
    });
  }

  // Distinct event_names with eligible rows. Paginate in case the set
  // is larger than the default Supabase cap (1000).
  const pageSize = 1000;
  const eventNamesSet = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data: rows, error } = await supabase
      .from("events")
      .select("event_name")
      .in("user_id", sharingIds)
      .eq("booked", true)
      .not("net_sales", "is", null)
      .gt("net_sales", 0)
      .neq("anomaly_flag", "disrupted")
      .range(offset, offset + pageSize - 1);
    if (error) {
      return NextResponse.json(
        { error: "events fetch failed", detail: error.message },
        { status: 500 }
      );
    }
    const batch = (rows ?? []) as Array<{ event_name: string | null }>;
    for (const r of batch) {
      if (r.event_name && r.event_name.trim()) {
        eventNamesSet.add(r.event_name);
      }
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  const eventNames = Array.from(eventNamesSet);

  const t0 = Date.now();
  // Chunked so one bad bucket doesn't take down the whole rebuild;
  // updatePlatformRegistry internally catches per-canonical failures.
  const chunkSize = 50;
  for (let i = 0; i < eventNames.length; i += chunkSize) {
    await updatePlatformRegistry(eventNames.slice(i, i + chunkSize));
  }
  const elapsedMs = Date.now() - t0;

  // Post-rebuild stats for the cron log.
  const { count: postCount } = await supabase
    .from("platform_events")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    ok: true,
    sharing_operators: sharingIds.length,
    event_names: eventNames.length,
    platform_events_rows: postCount ?? null,
    elapsed_ms: elapsedMs,
  });
}
