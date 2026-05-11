#!/usr/bin/env node
// Read-only: verify that the post-fix runtime path actually fires
// the platform prior for Wok-O on shared-name buckets where the
// only-other-real-operator is Best Wurst.
//
// Replicates the post-fix logic:
//   1. Sharing set = top-level (owner_user_id IS NULL) sharing-enabled
//      profiles. Viewer is INCLUDED.
//   2. Rows fetched + filtered to that set (no viewer exclusion yet).
//   3. Privacy floor: ≥2 distinct user_ids in the row set.
//   4. Aggregate computed on viewer-excluded subset (≥1 row required).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/verify-2op-fires.ts

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

const WOKO = "7f97040f-023d-4604-8b66-f5aa321c31de";
const NAMES_TO_CHECK = [
  "9 Mile Garden",
  "Scott Air Force Base",
  "Lunchtime Live",
  "Punk Rock Flea Market",
  "Shutterfest",
  "Dogtown St. Patrick's Day Parade",
  "St. Charles Riverfest",
  "Blues at the Arch",
];

async function main() {
  // Top-level sharing operators (post-manager-collapse fix).
  const { data: sharingUsers } = await supabase
    .from("profiles")
    .select("id, business_name")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  const sharingMap = new Map<string, string>();
  for (const u of (sharingUsers ?? []) as {
    id: string;
    business_name: string | null;
  }[]) {
    sharingMap.set(u.id, u.business_name ?? "(no business)");
  }
  const sharingIds = new Set(sharingMap.keys());
  console.log(
    `Top-level sharing operators: ${sharingIds.size} — ${Array.from(sharingMap.values()).join(", ")}`
  );
  console.log("");
  console.log(`Viewer (excludeUserId): Wok-O Taco [${WOKO}]`);
  console.log("");
  console.log("=".repeat(90));
  console.log(
    " Name                                   full-ops  viewer-other-rows  fires?  median"
  );
  console.log("=".repeat(90));

  for (const name of NAMES_TO_CHECK) {
    const { data: rows } = await supabase
      .from("events")
      .select("user_id, net_sales")
      .ilike("event_name", name)
      .eq("booked", true)
      .not("net_sales", "is", null)
      .gt("net_sales", 0)
      .neq("anomaly_flag", "disrupted");
    const eligible = ((rows ?? []) as {
      user_id: string;
      net_sales: number;
    }[]).filter((r) => sharingIds.has(r.user_id));
    const fullOps = new Set(eligible.map((r) => r.user_id));
    const excluded = eligible.filter((r) => r.user_id !== WOKO);
    const sortedSales = excluded
      .map((r) => r.net_sales)
      .sort((a, b) => a - b);
    const n = sortedSales.length;
    const median =
      n === 0
        ? 0
        : n % 2 === 0
        ? (sortedSales[n / 2 - 1] + sortedSales[n / 2]) / 2
        : sortedSales[Math.floor(n / 2)];
    const fires = fullOps.size >= 2 && excluded.length >= 1;
    console.log(
      `  ${name.padEnd(40)}${fullOps.size.toString().padStart(8)}${excluded.length
        .toString()
        .padStart(18)}    ${fires ? "✅ FIRES" : "❌"}    $${Math.round(median)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
