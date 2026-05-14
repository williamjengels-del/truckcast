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

  // Resolve event_name through the alias system so we match rows
  // stored under any alias form (e.g. "Fenton Food Truck Night" rolls
  // up to canonical "Fenton Food Truck Nights"). Production
  // getPlatformEventsExcludingUser does this via resolveAliases; the
  // trace script previously did exact-name lookup and misled on
  // alias-rich buckets (operator-notes v60 hand-off — flagged as
  // "trace-script alias gap").
  const normalizedInput = eventName.toLowerCase().trim();
  const { data: aliasRows } = await supabase
    .from("event_name_aliases")
    .select("canonical_normalized, alias_normalized");
  const aliasRecs = (aliasRows ?? []) as Array<{
    canonical_normalized: string;
    alias_normalized: string;
  }>;
  // Step 1: what canonical does our input map to?
  const aliasToCanonical = new Map<string, string>();
  for (const r of aliasRecs) aliasToCanonical.set(r.alias_normalized, r.canonical_normalized);
  const canonical = aliasToCanonical.get(normalizedInput) ?? normalizedInput;
  // Step 2: expand the canonical to ALL its alias forms (so the query
  // captures every operator-typed variant rolling up to this bucket).
  const allFormsSet = new Set<string>([canonical]);
  for (const r of aliasRecs) {
    if (r.canonical_normalized === canonical) allFormsSet.add(r.alias_normalized);
  }
  // Step 3: build a case-tolerant IN clause. event_name in the DB
  // preserves operator casing; the alias table normalizes lower/trim.
  // We need to match against ANY case variant — Postgres `ilike` with
  // an OR list does this efficiently for small sets. For our typical
  // 1-5 alias forms per canonical, a per-form `.or()` chain is fine.
  if (allFormsSet.size > 1) {
    console.log("");
    console.log(`Alias-expanded forms (canonical "${canonical}"):`);
    for (const f of allFormsSet) console.log(`  • ${f}`);
  }
  const allForms = Array.from(allFormsSet);
  // Build the .or() filter — ilike for case-insensitive exact match.
  const orFilter = allForms
    .map((f) => `event_name.ilike.${f.replace(/[,()]/g, "\\$&")}`)
    .join(",");
  const { data: rows, error } = await supabase
    .from("events")
    .select(
      "user_id, net_sales, event_name, event_date, booked, anomaly_flag"
    )
    .or(orFilter)
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
