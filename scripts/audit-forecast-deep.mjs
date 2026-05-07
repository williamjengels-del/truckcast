#!/usr/bin/env node
// Phase 1 deep-diagnostic of forecast accuracy. Designed to surface
// which structural issue is responsible for the engine's poor
// calibration: bad data getting into the stat, bad model fit, bad
// time-weighting, or bad confidence calibration.
//
// Builds on scripts/audit-forecast-accuracy.mjs (which only computed
// the rolling stat). This one slices the same eligible-event set
// across multiple dimensions:
//
//   1. Worst-miss events (full context, top 20)
//   2. Miss breakdown by event_mode (food_truck / catering)
//   3. Miss breakdown by fee_type (pre_settled / flat_fee / etc.)
//   4. Miss breakdown by event year (test time-decay hypothesis)
//   5. Over- vs under-forecasting bias direction
//   6. Worst event_names — events the engine consistently fails
//   7. Aggregate stats with isFixedRevenueEvent rows excluded
//      (these probably skew the stat because the engine forecasts
//      walk-up but the actual is contract + walk-up)
//
// Read-only: SELECT queries only, no writes. Safe to run against prod.

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const target = argv[0];

if (!target) {
  console.error(
    "Usage: node scripts/audit-forecast-deep.mjs <user-email-or-user-id>"
  );
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

let userId = target;
if (target.includes("@")) {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const match = users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
  if (!match) { console.error(`No user found with email ${target}`); process.exit(1); }
  userId = match.id;
}

const today = new Date().toISOString().slice(0, 10);

const { data: events, error } = await supabase
  .from("events")
  .select(
    "id, event_name, event_date, event_type, booked, net_sales, invoice_revenue, " +
      "event_mode, fee_type, fee_rate, sales_minimum, " +
      "forecast_sales, forecast_low, forecast_high, forecast_confidence, " +
      "anomaly_flag, cancellation_reason, event_weather, city, created_at"
  )
  .eq("user_id", userId)
  .order("event_date", { ascending: false });

if (error) { console.error("Query failed:", error); process.exit(1); }

// === isFixedRevenueEvent mirror src/lib/forecast-display.ts ===
function isFixedRevenueEvent(e) {
  if (e.event_mode === "catering") return true;
  if ((e.invoice_revenue ?? 0) > 0) return true;
  if (e.fee_type === "pre_settled") return true;
  if (e.fee_type === "commission_with_minimum" && (e.sales_minimum ?? 0) > 0) return true;
  return false;
}

// === Eligibility — same as forecast-vs-actual.ts ===
function isEligible(e) {
  if (!e.booked) return false;
  if (e.event_date >= today) return false;
  if (e.net_sales === null || e.net_sales <= 0) return false;
  if (e.forecast_sales === null || e.forecast_sales <= 0) return false;
  if (e.anomaly_flag === "disrupted") return false;
  if (e.anomaly_flag === "boosted") return false;
  return true;
}

function pctMiss(actual, forecast) {
  if (!forecast || forecast === 0) return null;
  return ((actual - forecast) / forecast) * 100;
}

function fmt(n, d = 1) { return n === null || n === undefined ? "—" : Number(n).toFixed(d); }
function fmtCurrency(n) { return n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString()}`; }

const eligibleAll = events.filter(isEligible);
const eligibleWithoutFixedRev = eligibleAll.filter((e) => !isFixedRevenueEvent(e));
const eligibleFixedRev = eligibleAll.filter((e) => isFixedRevenueEvent(e));

// === Insufficient-data floor projection ===
// Mirrors INSUFFICIENT_DATA_FLOOR_RATIO + computeOperatorOverallMedian in
// src/lib/forecast-engine.ts. Lets us project the audit's post-floor state
// from existing stored forecast values BEFORE the next prod recalc actually
// rewrites them to null. Once recalc runs in prod, isEligible will exclude
// floor-suppressed rows directly (forecast_sales becomes null) and the
// projection block converges with the headline aggregate.
const INSUFFICIENT_DATA_FLOOR_RATIO = 0.10;
function eventRevenue(e) {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
}
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const validHistorical = events.filter(
  (e) =>
    e.booked &&
    !e.cancellation_reason &&
    e.anomaly_flag !== "disrupted" &&
    ((e.net_sales ?? 0) > 0 ||
      (e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0))
);
const operatorOverallMedian = median(validHistorical.map(eventRevenue));
const floorThreshold = INSUFFICIENT_DATA_FLOOR_RATIO * operatorOverallMedian;
function wouldFlagInsufficient(e) {
  if (operatorOverallMedian <= 0) return false;
  if (!e.forecast_sales || e.forecast_sales <= 0) return false;
  return e.forecast_sales < floorThreshold;
}
const eligibleAfterFloor = eligibleAll.filter((e) => !wouldFlagInsufficient(e));
const wouldBeSuppressed = eligibleAll.filter(wouldFlagInsufficient);

console.log(`\n${"=".repeat(70)}`);
console.log(`PHASE 1 DIAGNOSTIC — Forecast-vs-actual deep audit`);
console.log(`User: ${userId}`);
console.log(`Today: ${today}`);
console.log(`Total events on file: ${events.length}`);
console.log(`Eligible (current filter): ${eligibleAll.length}`);
console.log(`  - Of which isFixedRevenueEvent: ${eligibleFixedRev.length}`);
console.log(`  - Of which NOT isFixedRevenueEvent (pure forecast comparison): ${eligibleWithoutFixedRev.length}`);
console.log(`${"=".repeat(70)}\n`);

// === Aggregate stats: with vs without fixed-revenue rows ===
function aggregateStats(events, label) {
  if (events.length === 0) {
    console.log(`\n--- ${label}: no events ---`);
    return;
  }
  const misses = events.map((e) => Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0)).sort((a, b) => a - b);
  const directionalMisses = events.map((e) => pctMiss(e.net_sales, e.forecast_sales) ?? 0);
  const overCount = directionalMisses.filter((m) => m > 0).length;
  const underCount = directionalMisses.filter((m) => m < 0).length;
  const meanDir = directionalMisses.reduce((s, m) => s + m, 0) / directionalMisses.length;

  // % within standardized thresholds
  const within20 = events.filter((e) => Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0) <= 20).length;
  const within30 = events.filter((e) => Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0) <= 30).length;
  const within50 = events.filter((e) => Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0) <= 50).length;

  // Within engine-stated range
  const withinEngineRange = events.filter((e) => {
    if (e.forecast_low === null || e.forecast_high === null) return false;
    return e.net_sales >= e.forecast_low && e.net_sales <= e.forecast_high;
  }).length;

  console.log(`\n--- ${label} (n=${events.length}) ---`);
  console.log(`  Within ±20% flat:           ${within20}/${events.length} (${((within20/events.length)*100).toFixed(1)}%)`);
  console.log(`  Within ±30% flat:           ${within30}/${events.length} (${((within30/events.length)*100).toFixed(1)}%)`);
  console.log(`  Within ±50% flat:           ${within50}/${events.length} (${((within50/events.length)*100).toFixed(1)}%)`);
  console.log(`  Within engine stated range: ${withinEngineRange}/${events.length} (${((withinEngineRange/events.length)*100).toFixed(1)}%)`);
  console.log(`  |miss| median:              ${fmt(misses[Math.floor(misses.length / 2)])}%`);
  console.log(`  Direction:                  ${overCount} over (${((overCount/events.length)*100).toFixed(0)}%) / ${underCount} under (${((underCount/events.length)*100).toFixed(0)}%)`);
  console.log(`  Mean directional miss:      ${fmt(meanDir)}% (${meanDir > 0 ? "over-shoot bias" : "under-shoot bias"})`);
}

aggregateStats(eligibleAll, "ALL eligible (current filter)");
aggregateStats(eligibleWithoutFixedRev, "EXCLUDING fixed-revenue rows (catering/pre_settled/etc.)");
aggregateStats(eligibleFixedRev, "FIXED-revenue rows only (likely systematic miss source)");

console.log(`\n${"=".repeat(70)}`);
console.log(`INSUFFICIENT-DATA FLOOR PROJECTION`);
console.log(`Operator overall median event revenue: ${fmtCurrency(operatorOverallMedian)}`);
console.log(`Floor threshold (10% of median):       ${fmtCurrency(floorThreshold)}`);
console.log(`Rows below floor (would be suppressed): ${wouldBeSuppressed.length} of ${eligibleAll.length}`);
console.log(`${"=".repeat(70)}`);
aggregateStats(eligibleAfterFloor, "ELIGIBLE AFTER FLOOR (Layer 1 acceptance check)");
if (wouldBeSuppressed.length > 0) {
  console.log(`\n--- Top 10 rows the floor would suppress ---`);
  const sorted = [...wouldBeSuppressed]
    .map((e) => ({ ...e, missAbs: Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0) }))
    .sort((a, b) => b.missAbs - a.missAbs);
  for (const r of sorted.slice(0, 10)) {
    console.log(
      `  ${r.event_date}  forecast=${fmtCurrency(r.forecast_sales).padStart(7)} actual=${fmtCurrency(r.net_sales).padStart(7)}  ` +
        `miss=${(r.missAbs).toFixed(0).padStart(5)}%  ${r.event_name}`
    );
  }
}

// === By event_mode ===
console.log(`\n${"=".repeat(70)}`);
console.log(`BREAKDOWN BY event_mode`);
console.log(`${"=".repeat(70)}`);
const byMode = {};
for (const e of eligibleAll) {
  const m = e.event_mode ?? "null";
  if (!byMode[m]) byMode[m] = [];
  byMode[m].push(e);
}
for (const [mode, evs] of Object.entries(byMode)) {
  aggregateStats(evs, `event_mode = ${mode}`);
}

// === By fee_type ===
console.log(`\n${"=".repeat(70)}`);
console.log(`BREAKDOWN BY fee_type`);
console.log(`${"=".repeat(70)}`);
const byFeeType = {};
for (const e of eligibleAll) {
  const f = e.fee_type ?? "null";
  if (!byFeeType[f]) byFeeType[f] = [];
  byFeeType[f].push(e);
}
for (const [ft, evs] of Object.entries(byFeeType)) {
  aggregateStats(evs, `fee_type = ${ft}`);
}

// === By year (time-decay test) ===
console.log(`\n${"=".repeat(70)}`);
console.log(`BREAKDOWN BY event year (testing time-decay hypothesis)`);
console.log(`${"=".repeat(70)}`);
const byYear = {};
for (const e of eligibleWithoutFixedRev) {
  const y = e.event_date.slice(0, 4);
  if (!byYear[y]) byYear[y] = [];
  byYear[y].push(e);
}
const yearKeys = Object.keys(byYear).sort();
for (const y of yearKeys) {
  aggregateStats(byYear[y], `year = ${y} (excl. fixed-rev)`);
}

// === Confidence label distribution + miss% per ===
console.log(`\n${"=".repeat(70)}`);
console.log(`BREAKDOWN BY forecast_confidence (excluding fixed-rev rows)`);
console.log(`${"=".repeat(70)}`);
const byConf = {};
for (const e of eligibleWithoutFixedRev) {
  const c = e.forecast_confidence ?? "null";
  if (!byConf[c]) byConf[c] = [];
  byConf[c].push(e);
}
for (const [conf, evs] of Object.entries(byConf)) {
  aggregateStats(evs, `forecast_confidence = ${conf}`);
}

// === Worst miss events (top 20) ===
console.log(`\n${"=".repeat(70)}`);
console.log(`TOP 20 WORST-MISS EVENTS (excluding fixed-rev rows)`);
console.log(`${"=".repeat(70)}`);
const worstMisses = [...eligibleWithoutFixedRev]
  .map((e) => ({ ...e, missAbs: Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0), missDir: pctMiss(e.net_sales, e.forecast_sales) ?? 0 }))
  .sort((a, b) => b.missAbs - a.missAbs)
  .slice(0, 20);
for (const r of worstMisses) {
  console.log(
    `  ${r.event_date}  miss=${(r.missDir > 0 ? "+" : "")}${fmt(r.missDir, 0)}%  ` +
      `forecast=${fmtCurrency(r.forecast_sales).padStart(7)} actual=${fmtCurrency(r.net_sales).padStart(7)}  ` +
      `conf=${(r.forecast_confidence ?? "null").padEnd(6)} ` +
      `mode=${(r.event_mode ?? "null").padEnd(11)} fee=${(r.fee_type ?? "null").padEnd(20)} ` +
      `${r.event_name}`
  );
}

// === Worst event_names by avg miss%, where the operator has multiple events ===
console.log(`\n${"=".repeat(70)}`);
console.log(`WORST EVENT_NAMES BY AVG |miss| (>= 3 events, excl. fixed-rev)`);
console.log(`${"=".repeat(70)}`);
const byName = {};
for (const e of eligibleWithoutFixedRev) {
  if (!byName[e.event_name]) byName[e.event_name] = [];
  byName[e.event_name].push(e);
}
const nameRollup = Object.entries(byName)
  .filter(([, evs]) => evs.length >= 3)
  .map(([name, evs]) => {
    const misses = evs.map((e) => Math.abs(pctMiss(e.net_sales, e.forecast_sales) ?? 0));
    const avgMiss = misses.reduce((s, m) => s + m, 0) / misses.length;
    return { name, count: evs.length, avgMiss };
  })
  .sort((a, b) => b.avgMiss - a.avgMiss);

for (const r of nameRollup.slice(0, 15)) {
  console.log(`  avg |miss|=${fmt(r.avgMiss).padStart(6)}%  n=${String(r.count).padStart(3)}  ${r.name}`);
}

console.log(`\n... (showing top 15 of ${nameRollup.length} multi-event event_names)\n`);

// === Best event_names ===
console.log(`\n${"=".repeat(70)}`);
console.log(`BEST EVENT_NAMES BY AVG |miss| (>= 3 events, excl. fixed-rev)`);
console.log(`${"=".repeat(70)}`);
for (const r of nameRollup.slice(-10).reverse()) {
  console.log(`  avg |miss|=${fmt(r.avgMiss).padStart(6)}%  n=${String(r.count).padStart(3)}  ${r.name}`);
}

console.log(`\n${"=".repeat(70)}`);
console.log(`SUMMARY`);
console.log(`${"=".repeat(70)}`);
console.log(`If the "EXCLUDING fixed-revenue rows" rate is much better than ALL,`);
console.log(`pre-settled / catering events are skewing the stat — fixable via filter.`);
console.log(``);
console.log(`If by-year miss% is decreasing (older years worse), time-decay would help.`);
console.log(``);
console.log(`If HIGH/MEDIUM/LOW confidence rates are similar (or HIGH worse), the`);
console.log(`confidence score isn't predicting accuracy — needs reformulation.`);
console.log(``);
console.log(`If a few event_names dominate the worst-misses list, those events have`);
console.log(`unusual variance the engine isn't capturing — operator could flag them`);
console.log(`as boosted/disrupted, OR engine should expand variance for those.`);
