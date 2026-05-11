#!/usr/bin/env node
// Read-only: list operators with data_sharing_enabled=true and a rough
// event-count summary per operator. Tells us who's in the platform
// aggregate pool. Useful when platform_events shows operator_count >= 3
// and we don't know who the third operator is.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/who-shares-data.ts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, business_name, city, state, subscription_tier, data_sharing_enabled, onboarding_completed"
    )
    .eq("data_sharing_enabled", true)
    .order("business_name", { ascending: true });
  if (error) {
    console.error("profiles fetch failed:", error.message);
    process.exit(1);
  }
  const profiles = data ?? [];
  console.log(`Operators with data_sharing_enabled=true: ${profiles.length}`);
  console.log("");
  for (const p of profiles) {
    const { data: counts } = await supabase
      .from("events")
      .select("event_date, net_sales")
      .eq("user_id", p.id);
    const total = (counts ?? []).length;
    const withSales = (counts ?? []).filter(
      (r) => r.net_sales != null && (r.net_sales as number) > 0
    ).length;
    console.log(
      `  ${p.business_name ?? "(no business_name)"}  [${p.id}]  ${p.city ?? "—"}, ${p.state ?? "—"}  tier=${p.subscription_tier}  onboarded=${p.onboarding_completed}`
    );
    console.log(
      `      events: ${total} total, ${withSales} with net_sales > 0`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
