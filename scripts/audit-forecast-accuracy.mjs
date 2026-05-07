#!/usr/bin/env node
// Operator diagnostic: audit forecast-vs-actual accuracy for a given
// user. Mirrors the dashboard forecast card's logic (PR #213) so we
// can verify what the operator is seeing and decompose the
// "X of Y in range" stat by confidence level + outcome.
//
// Built to answer Julian's 2026-05-07 question: "It looks like my
// forecast accuracy dropped to 42 percent now on the dashboard."
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/audit-forecast-accuracy.mjs <user-email-or-user-id>
//
// Read-only: SELECT queries only, no writes. Safe to run against prod.

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const target = argv[0];

if (!target) {
  console.error(
    "Usage: node scripts/audit-forecast-accuracy.mjs <user-email-or-user-id>"
  );
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Resolve user id from email-or-id input.
let userId = target;
if (target.includes("@")) {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const match = users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
  if (!match) {
    console.error(`No user found with email ${target}`);
    process.exit(1);
  }
  userId = match.id;
}

console.error(`Auditing forecast accuracy for user ${userId}\n`);

const { data: events, error } = await supabase
  .from("events")
  .select(
    "id, event_name, event_date, booked, net_sales, invoice_revenue, " +
      "event_mode, forecast_sales, forecast_low, forecast_high, " +
      "forecast_confidence, anomaly_flag, cancellation_reason, created_at"
  )
  .eq("user_id", userId)
  .order("event_date", { ascending: false });

if (error) {
  console.error("Query failed:", error);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const monthPrefix = today.slice(0, 7);

// Mirror src/lib/forecast-vs-actual.ts isEligible.
function isEligible(e) {
  if (!e.booked) return false;
  if (e.event_date >= today) return false;
  if (e.net_sales === null || e.net_sales <= 0) return false;
  if (e.forecast_sales === null || e.forecast_sales <= 0) return false;
  if (e.anomaly_flag === "disrupted") return false;
  return true;
}

function rangeBoundsFor(e) {
  if (e.forecast_low !== null && e.forecast_high !== null) {
    return { low: e.forecast_low, high: e.forecast_high, hasExplicitBounds: true };
  }
  const f = e.forecast_sales ?? 0;
  return { low: f * 0.8, high: f * 1.2, hasExplicitBounds: false };
}

function classify(actual, low, high) {
  if (actual < low) return "below_range";
  if (actual > high) return "above_range";
  return "within_range";
}

function pctMiss(actual, forecast) {
  if (!forecast || forecast === 0) return null;
  return ((actual - forecast) / forecast) * 100;
}

const eligibleAll = events.filter(isEligible);
const eligibleMonth = eligibleAll.filter((e) =>
  e.event_date.startsWith(monthPrefix)
);

// Counts breakdown — by confidence + outcome (engine ranges).
const buckets = {
  HIGH: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
  MEDIUM: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
  LOW: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
  null: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
};

const monthBuckets = {
  HIGH: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
  MEDIUM: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
  LOW: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
  null: { withinEngine: 0, belowEngine: 0, aboveEngine: 0, within20pct: 0, total: 0 },
};

function fillBuckets(events, buckets) {
  for (const e of events) {
    const conf = e.forecast_confidence ?? "null";
    const bucket = buckets[conf] ?? buckets["null"];
    const { low, high } = rangeBoundsFor(e);
    const outcome = classify(e.net_sales, low, high);
    if (outcome === "within_range") bucket.withinEngine++;
    else if (outcome === "below_range") bucket.belowEngine++;
    else bucket.aboveEngine++;
    // Compare against the homepage's ±20% standard
    const pct = Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0);
    if (pct <= 20) bucket.within20pct++;
    bucket.total++;
  }
}

fillBuckets(eligibleAll, buckets);
fillBuckets(eligibleMonth, monthBuckets);

function summarize(buckets, label) {
  console.log(`\n=== ${label} ===`);
  let total = 0,
    inEngine = 0,
    in20 = 0;
  for (const [k, v] of Object.entries(buckets)) {
    if (v.total === 0) continue;
    const enginePct = ((v.withinEngine / v.total) * 100).toFixed(1);
    const flat20Pct = ((v.within20pct / v.total) * 100).toFixed(1);
    console.log(
      `  ${k.padEnd(8)} ${String(v.total).padStart(4)} events  ·  ` +
        `engine range: ${v.withinEngine}/${v.total} in (${enginePct}%) ` +
        `[${v.belowEngine} below, ${v.aboveEngine} above]  ·  ` +
        `±20% flat: ${v.within20pct}/${v.total} in (${flat20Pct}%)`
    );
    total += v.total;
    inEngine += v.withinEngine;
    in20 += v.within20pct;
  }
  if (total > 0) {
    console.log(
      `  ${"TOTAL".padEnd(8)} ${String(total).padStart(4)} events  ·  ` +
        `engine range: ${inEngine}/${total} (${((inEngine / total) * 100).toFixed(1)}%)  ·  ` +
        `±20% flat: ${in20}/${total} (${((in20 / total) * 100).toFixed(1)}%)`
    );
  }
}

console.log(`Today: ${today}, month prefix: ${monthPrefix}`);
console.log(`Total events on file: ${events.length}`);
console.log(`Eligible (past, booked, has actual + forecast, not disrupted): ${eligibleAll.length}`);
console.log(`Eligible THIS MONTH: ${eligibleMonth.length}`);

summarize(buckets, "All-time eligible");
summarize(monthBuckets, `This month (${monthPrefix})`);

// === Percentile distribution of |pct_miss| — used to derive
//     defensible band values for engine recalibration.
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

function summarizeMissDistribution(events, label) {
  const misses = events
    .map((e) => Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0))
    .sort((a, b) => a - b);
  if (misses.length === 0) return;
  console.log(`\n=== |pct_miss| distribution: ${label} (n=${misses.length}) ===`);
  console.log(`  p10:  ${percentile(misses, 10).toFixed(1)}%`);
  console.log(`  p25:  ${percentile(misses, 25).toFixed(1)}%`);
  console.log(`  p50:  ${percentile(misses, 50).toFixed(1)}%  (median)`);
  console.log(`  p75:  ${percentile(misses, 75).toFixed(1)}%`);
  console.log(`  p80:  ${percentile(misses, 80).toFixed(1)}%`);
  console.log(`  p90:  ${percentile(misses, 90).toFixed(1)}%`);
  console.log(`  p95:  ${percentile(misses, 95).toFixed(1)}%`);
  console.log(`  max:  ${misses[misses.length - 1].toFixed(1)}%`);
  // What ±% threshold would catch X% of forecasts?
  console.log(`\n  Threshold to catch:`);
  for (const pct of [25, 30, 40, 50, 60, 70, 80]) {
    const t = percentile(misses, pct);
    if (t !== null) {
      console.log(`    ${pct}% of forecasts → within ±${t.toFixed(0)}% of actual`);
    }
  }
}

summarizeMissDistribution(eligibleAll, "All-time eligible");
summarizeMissDistribution(
  eligibleAll.filter((e) => e.forecast_confidence === "HIGH"),
  "HIGH confidence only"
);
summarizeMissDistribution(
  eligibleAll.filter((e) => e.forecast_confidence === "MEDIUM"),
  "MEDIUM confidence only"
);
summarizeMissDistribution(
  eligibleAll.filter((e) => e.forecast_confidence === "LOW"),
  "LOW confidence only"
);

// Show the worst-miss month-events so we can eyeball them.
console.log(`\n=== This-month events ranked by miss magnitude ===`);
const ranked = [...eligibleMonth]
  .map((e) => {
    const { low, high } = rangeBoundsFor(e);
    return {
      event_date: e.event_date,
      event_name: e.event_name,
      forecast: e.forecast_sales,
      low,
      high,
      actual: e.net_sales,
      confidence: e.forecast_confidence,
      pct_miss: pctMiss(e.net_sales, e.forecast_sales),
      outcome: classify(e.net_sales, low, high),
    };
  })
  .sort((a, b) => Math.abs(b.pct_miss) - Math.abs(a.pct_miss));

for (const r of ranked) {
  console.log(
    `  ${r.event_date}  ${r.outcome.padEnd(13)} conf=${(r.confidence ?? "null").padEnd(6)}  ` +
      `forecast=$${r.forecast?.toFixed(0).padStart(5) ?? "  ?  "} ` +
      `[$${r.low.toFixed(0)}–$${r.high.toFixed(0)}]  ` +
      `actual=$${r.actual?.toFixed(0).padStart(5) ?? "  ?  "}  ` +
      `(${r.pct_miss?.toFixed(1) ?? "?"}%)  ${r.event_name}`
  );
}
