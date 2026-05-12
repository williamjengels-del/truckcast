#!/usr/bin/env node
// Read-only: trace why platform-prior is / isn't firing for a specific
// event name on a specific user. Mirrors getPlatformEventsExcludingUser
// production semantics from platform-registry.ts.
//
// Privacy-floor semantics (post-PR-#265, 2026-05-09):
//   • Viewer is KEPT in `sharingUserIds` for counting.
//   • Privacy floor = full bucket has >= 2 distinct operators (viewer
//     included). The aggregate "represents" 2 operators' data; viewer
//     just happens to be one of them.
//   • Median + percentiles are computed on the viewer-EXCLUDED subset
//     so the operator never sees a blend regressing toward their own
//     mean.
//
// The earlier shape of this script stripped the viewer from
// `sharingIds` BEFORE counting, which gave false-negative readings
// against production (would report "would NOT fire" on buckets that
// actually fire today). Updated 2026-05-13 to match production.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/trace-platform-prior-for-name.ts <event-name> [viewer-user-id]
//
// Defaults viewer to Wok-O Taco when only the event name is provided.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const eventName = process.argv[2];
const viewerUserId =
  process.argv[3] ?? "7f97040f-023d-4604-8b66-f5aa321c31de";
if (!eventName) {
  console.error("Usage: trace-platform-prior-for-name.ts <event-name> [viewer-user-id]");
  process.exit(2);
}

async function main() {
  console.log(`Tracing platform prior for: "${eventName}"`);
  console.log(`Viewer (forecast requester): ${viewerUserId}`);
  console.log("");

  // Sharing users — top-level operators only (managers filtered via
  // owner_user_id IS NULL). Matches platform-registry.ts:604-611.
  const { data: sharingUsers } = await supabase
    .from("profiles")
    .select("id, business_name, owner_user_id, onboarding_completed")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  const sharingRows = (sharingUsers ?? []) as Array<{
    id: string;
    business_name: string | null;
    owner_user_id: string | null;
    onboarding_completed: boolean;
  }>;
  console.log(`Sharing-enabled top-level operators: ${sharingRows.length}`);
  for (const u of sharingRows) {
    const youTag = u.id === viewerUserId ? "  ← viewer" : "";
    console.log(
      `  ${u.id}  ${u.business_name ?? "(no business)"}  onboarded=${u.onboarding_completed}${youTag}`
    );
  }
  // KEEP viewer in sharingIds — production semantics.
  const sharingIds = new Set(sharingRows.map((u) => u.id));
  console.log("");

  // Same query as platform-registry.ts:618-630.
  const { data: rows, error } = await supabase
    .from("events")
    .select(
      "user_id, net_sales, event_name, event_date, booked, anomaly_flag"
    )
    .in("event_name", [eventName])
    .eq("booked", true)
    .not("net_sales", "is", null)
    .gt("net_sales", 0)
    .neq("anomaly_flag", "disrupted");
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(`Eligible rows (booked, net_sales>0, not disrupted): ${(rows ?? []).length}`);

  // Sharing filter — viewer stays in.
  const eligible = ((rows ?? []) as Array<{
    user_id: string;
    net_sales: number;
    event_name: string;
    event_date: string;
  }>).filter((r) => sharingIds.has(r.user_id));
  console.log(`After sharing-only filter (viewer KEPT):  ${eligible.length}`);

  // Per-user breakdown across the full bucket.
  const byUser = new Map<string, number>();
  for (const r of eligible) {
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
  }
  console.log("");
  console.log("Per-user contribution (full bucket):");
  for (const [uid, n] of byUser) {
    const profile = sharingRows.find((u) => u.id === uid);
    const label = profile?.business_name ?? "(no business)";
    const youTag = uid === viewerUserId ? "  ← viewer" : "";
    console.log(`  ${label.padEnd(20)} ${n} events${youTag}`);
  }

  // Privacy floor: full bucket has >= 2 distinct operators.
  const fullOpCount = byUser.size;
  const wouldFire = fullOpCount >= 2;
  console.log("");
  console.log(`Full-bucket operator_count (viewer included): ${fullOpCount}`);
  console.log(
    `Platform prior fires when full-bucket operator_count >= 2. Result: ${wouldFire ? "✅ WOULD FIRE" : "❌ would NOT fire"}`
  );

  if (wouldFire) {
    // Show what the median computation would see (viewer-excluded subset).
    const viewerExcluded = eligible.filter((r) => r.user_id !== viewerUserId);
    const otherOps = new Set(viewerExcluded.map((r) => r.user_id));
    const sales = viewerExcluded
      .map((r) => r.net_sales)
      .sort((a, b) => a - b);
    const n = sales.length;
    const median =
      n === 0
        ? null
        : n % 2 === 0
          ? (sales[n / 2 - 1] + sales[n / 2]) / 2
          : sales[Math.floor(n / 2)];
    console.log("");
    console.log("Viewer-excluded subset (what the median is computed on):");
    console.log(`  contributing operators: ${otherOps.size}`);
    console.log(`  events: ${n}`);
    console.log(
      `  median net_sales: ${median !== null ? `$${Math.round(median * 100) / 100}` : "—"}`
    );
  }

  // Also check the cached platform_events row.
  const { data: peRow } = await supabase
    .from("platform_events")
    .select("*")
    .eq("event_name_normalized", eventName.toLowerCase().trim())
    .maybeSingle();
  if (peRow) {
    console.log("");
    console.log(`Cached platform_events row exists:`);
    console.log(`  operator_count = ${(peRow as Record<string, unknown>).operator_count}`);
    console.log(`  total_instances = ${(peRow as Record<string, unknown>).total_instances}`);
    console.log(`  median_sales = ${(peRow as Record<string, unknown>).median_sales}`);
  } else {
    console.log("");
    console.log(`No cached platform_events row for "${eventName.toLowerCase().trim()}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
