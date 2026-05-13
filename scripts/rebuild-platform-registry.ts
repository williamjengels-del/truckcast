#!/usr/bin/env node
// Rebuild the platform_events registry from scratch.
//
// Why: updatePlatformRegistry() is only called from recalculateForUser
// against the operator's own upcoming event names. So buckets touched
// by a different operator's recalc — or buckets where the contributing
// events have since been deleted / disrupted / had data_sharing flipped
// — drift out of sync. The 2026-05-13 cross-op diagnostic surfaced one
// such row ("Lunchtime Live in Kiener Plaza" cached op_count=3 / n=14;
// live read returns 5 events from 1 operator).
//
// The live read-path (getPlatformEventsExcludingUser) is authoritative
// for the engine, so stale cache doesn't affect forecasts. But the
// cache misleads anything that reads it directly (admin views,
// diagnostics, /dashboard/insights summaries). This script realigns
// the cache.
//
// What it does:
//   1. Enumerates every distinct event_name across all sharing-enabled
//      top-level operators (data_sharing_enabled=true, owner_user_id IS
//      NULL) where booked AND net_sales>0 AND not disrupted.
//   2. Resolves aliases via event_name_aliases so multiple alias-form
//      names collapse to canonical buckets.
//   3. Hands the full canonical list to updatePlatformRegistry(), which
//      recomputes each bucket's aggregate from scratch — INCLUDING
//      deleting platform_events rows where backing data has vanished.
//
// Read-only of operator data (events, profiles). Writes only to the
// platform_events cache. Idempotent — safe to re-run anytime.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/rebuild-platform-registry.ts [--dry-run]
//
// --dry-run: list the canonical event names that WOULD be recomputed,
//            without writing anything.

import { createClient } from "@supabase/supabase-js";
import { updatePlatformRegistry } from "../src/lib/platform-registry";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
  process.exit(2);
}

const dryRun = process.argv.includes("--dry-run");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log(" platform_events registry rebuild");
  console.log("=".repeat(70));
  console.log("");

  // 1. Sharing operators (top-level only)
  const { data: sharingUsers, error: profErr } = await supabase
    .from("profiles")
    .select("id, business_name")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  if (profErr) {
    console.error("profiles fetch failed:", profErr.message);
    process.exit(1);
  }
  const sharingRows = (sharingUsers ?? []) as Array<{
    id: string;
    business_name: string | null;
  }>;
  const sharingIds = sharingRows.map((u) => u.id);
  console.log(`Sharing-enabled top-level operators: ${sharingRows.length}`);
  for (const u of sharingRows) {
    console.log(`  • ${u.business_name ?? "(no business)"}  [${u.id}]`);
  }
  console.log("");
  if (sharingIds.length === 0) {
    console.log("No sharing operators — nothing to rebuild. Exiting.");
    return;
  }

  // 2. Distinct event_names with eligible rows. Paginate in case the
  //    set is large (Supabase default cap is 1000).
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
      console.error("events fetch failed:", error.message);
      process.exit(1);
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
  console.log(`Distinct raw event_names across sharing operators: ${eventNames.length}`);
  console.log("");

  // 3. Pre-rebuild snapshot of platform_events row count
  const { count: preCount } = await supabase
    .from("platform_events")
    .select("*", { count: "exact", head: true });
  console.log(`platform_events rows before rebuild: ${preCount ?? "?"}`);
  console.log("");

  if (dryRun) {
    console.log("[dry-run] Would recompute these event_names:");
    for (const n of eventNames.slice(0, 50)) {
      console.log(`  • ${n}`);
    }
    if (eventNames.length > 50) {
      console.log(`  … and ${eventNames.length - 50} more`);
    }
    console.log("");
    console.log("Re-run without --dry-run to apply.");
    return;
  }

  // 4. Recompute. updatePlatformRegistry handles alias resolution,
  //    canonical bucketing, and stale-row deletion.
  console.log("Rebuilding registry…");
  const t0 = Date.now();
  // Pass in chunks to avoid one giant transaction — each canonical
  // does its own upsert / delete, so chunking only affects logging.
  const chunkSize = 50;
  for (let i = 0; i < eventNames.length; i += chunkSize) {
    const chunk = eventNames.slice(i, i + chunkSize);
    await updatePlatformRegistry(chunk);
    if ((i / chunkSize) % 5 === 0) {
      console.log(`  …${Math.min(i + chunkSize, eventNames.length)}/${eventNames.length}`);
    }
  }
  const elapsedMs = Date.now() - t0;
  console.log("");
  console.log(`Recompute finished in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log("");

  // 5. Post-rebuild snapshot
  const { count: postCount } = await supabase
    .from("platform_events")
    .select("*", { count: "exact", head: true });
  const { data: opCount2Plus } = await supabase
    .from("platform_events")
    .select("event_name_normalized, operator_count, total_instances", {
      count: "exact",
    })
    .gte("operator_count", 2);
  const opCount2PlusRows = (opCount2Plus ?? []) as Array<{
    event_name_normalized: string;
    operator_count: number;
    total_instances: number;
  }>;
  console.log(`platform_events rows after rebuild: ${postCount ?? "?"}`);
  console.log(
    `  of which operator_count >= 2 (eligible for platform-prior): ${opCount2PlusRows.length}`
  );
  console.log("");

  const delta = (postCount ?? 0) - (preCount ?? 0);
  if (delta !== 0) {
    console.log(`Net change: ${delta > 0 ? "+" : ""}${delta} rows`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
