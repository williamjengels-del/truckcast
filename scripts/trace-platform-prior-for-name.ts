#!/usr/bin/env node
// Read-only: trace why platform-prior isn't firing for a specific event name
// on a specific user. Replicates getPlatformEventsExcludingUser logic.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/trace-platform-prior-for-name.ts <event-name> [excluded-user-id]

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
const excludeUserId =
  process.argv[3] ?? "7f97040f-023d-4604-8b66-f5aa321c31de";
if (!eventName) {
  console.error("Usage: trace-platform-prior-for-name.ts <event-name> [excluded-user-id]");
  process.exit(2);
}

async function main() {
  console.log(`Tracing platform prior for: "${eventName}"`);
  console.log(`Excluding user: ${excludeUserId}`);
  console.log("");

  // Sharing users — top-level operators only (matches post-fix
  // platform-registry.ts which filters owner_user_id IS NULL so
  // managers don't count as a second operator).
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
  console.log(`Sharing-enabled users: ${sharingRows.length}`);
  for (const u of sharingRows) {
    const tag = u.owner_user_id ? `  (MANAGER of ${u.owner_user_id})` : "";
    console.log(`  ${u.id}  ${u.business_name ?? "(no business)"}${tag}  onboarded=${u.onboarding_completed}`);
  }
  const sharingIds = new Set(sharingRows.map((u) => u.id));
  sharingIds.delete(excludeUserId);
  console.log("");
  console.log(`After excluding requester: ${sharingIds.size} sharing operators`);

  // Same query as platform-registry.ts:549-561
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
  console.log("");
  console.log(`Eligible rows (booked, net_sales>0, not disrupted): ${(rows ?? []).length}`);
  const eligible = ((rows ?? []) as Array<{
    user_id: string;
    net_sales: number;
    event_name: string;
    event_date: string;
  }>).filter((r) => r.user_id !== excludeUserId && sharingIds.has(r.user_id));
  console.log(`After exclude + sharing filter:  ${eligible.length}`);

  // Group by user_id to count unique operators
  const byUser = new Map<string, number>();
  for (const r of eligible) {
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
  }
  console.log("");
  console.log("Per-user contribution:");
  for (const [uid, n] of byUser) {
    const profile = sharingRows.find((u) => u.id === uid);
    const label = profile?.business_name ?? "(no business)";
    const tag = profile?.owner_user_id ? "  (MANAGER)" : "";
    console.log(`  ${label.padEnd(20)} ${n} events${tag}`);
  }
  console.log("");
  console.log(`operator_count (distinct user_ids): ${byUser.size}`);
  console.log(
    `Platform prior fires when operator_count >= 2. Result: ${byUser.size >= 2 ? "✅ WOULD FIRE" : "❌ would NOT fire"}`
  );

  // Also check the cached platform_events row
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
