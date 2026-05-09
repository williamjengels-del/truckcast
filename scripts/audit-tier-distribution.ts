#!/usr/bin/env node
// Read-only audit of event_size_tier_inferred distribution. Quick
// sanity-check after the tier foundation migration applies + first
// recalc populates the column.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/audit-tier-distribution.ts <user-id>

import { createClient } from "@supabase/supabase-js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/audit-tier-distribution.ts <user-id>");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
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
    .from("events")
    .select("event_name, event_date, net_sales, invoice_revenue, event_mode, event_size_tier_inferred, anomaly_flag, booked")
    .eq("user_id", userId)
    .order("event_date", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const t = r.event_size_tier_inferred ?? "(null)";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  console.log(`\nTotal events: ${rows.length}`);
  console.log(`\nTier distribution (all rows):`);
  for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const pct = ((n / rows.length) * 100).toFixed(1);
    console.log(`  ${t.padEnd(12)} ${String(n).padStart(4)}  ${pct}%`);
  }

  // FLAGSHIP — sanity check (should include the calibration outliers:
  // St. Louis Music Park, Scott AFB, 9 Mile Garden, etc.)
  const flagship = rows.filter((r) => r.event_size_tier_inferred === "FLAGSHIP");
  console.log(`\nFLAGSHIP events (${flagship.length}) — top 25 most recent:`);
  for (const e of flagship.slice(0, 25)) {
    const rev =
      e.event_mode === "catering"
        ? e.invoice_revenue ?? 0
        : e.net_sales ?? 0;
    console.log(
      `  ${e.event_date}  $${String(Math.round(rev)).padStart(6)}  ${e.event_name}`
    );
  }

  // LARGE preview
  const large = rows.filter((r) => r.event_size_tier_inferred === "LARGE");
  console.log(`\nLARGE events (${large.length}) — top 10 most recent:`);
  for (const e of large.slice(0, 10)) {
    const rev =
      e.event_mode === "catering"
        ? e.invoice_revenue ?? 0
        : e.net_sales ?? 0;
    console.log(
      `  ${e.event_date}  $${String(Math.round(rev)).padStart(6)}  ${e.event_name}`
    );
  }

  // SMALL preview
  const small = rows.filter((r) => r.event_size_tier_inferred === "SMALL");
  console.log(`\nSMALL events (${small.length}) — top 10 most recent:`);
  for (const e of small.slice(0, 10)) {
    const rev =
      e.event_mode === "catering"
        ? e.invoice_revenue ?? 0
        : e.net_sales ?? 0;
    console.log(
      `  ${e.event_date}  $${String(Math.round(rev)).padStart(6)}  ${e.event_name}`
    );
  }

  // Null breakdown — events that didn't get a tier. Common causes:
  // future events (no actuals yet), event_name with no other instances
  // in the 12-month window (single-occurrence events), disrupted/boosted.
  const nullTier = rows.filter((r) => r.event_size_tier_inferred == null);
  let future = 0,
    noRevenue = 0,
    disrupted = 0,
    boosted = 0,
    unbooked = 0,
    other = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const e of nullTier) {
    if (e.event_date >= today) future++;
    else if (!e.booked) unbooked++;
    else if (e.anomaly_flag === "disrupted") disrupted++;
    else if (e.anomaly_flag === "boosted") boosted++;
    else {
      const rev =
        e.event_mode === "catering"
          ? e.invoice_revenue ?? 0
          : e.net_sales ?? 0;
      if (rev <= 0) noRevenue++;
      else other++;
    }
  }
  console.log(`\nNull-tier breakdown (${nullTier.length}):`);
  console.log(`  future events           ${future}`);
  console.log(`  unbooked                ${unbooked}`);
  console.log(`  disrupted (excluded)    ${disrupted}`);
  console.log(`  boosted (excluded)      ${boosted}`);
  console.log(`  no revenue              ${noRevenue}`);
  console.log(`  past+actuals, no median ${other}  ← single-occurrence event_name (no peers in 12-mo window)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
