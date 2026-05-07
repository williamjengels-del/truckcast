#!/usr/bin/env node
// Live calibration report for the Bayesian v2 shadow rollout.
//
// Reads stored forecast_bayesian_* columns from the events table
// (populated by recalculateForUser when the shadow-columns migration
// is applied) and reports calibration metrics against actuals. Use
// this on a regular cadence (weekly?) to monitor whether v2 is
// living up to its stated 80% / 50% credible intervals on real
// production data.
//
// Differs from compare-engines.ts:
//   - compare-engines.ts runs the engine LIVE on past data (leave-one-
//     out), useful for "what would v2 have said" experiments
//   - this script reads what v2 ACTUALLY WROTE, useful for "is the
//     stored shadow data living up to its promises"
//
// Read-only. Service-role client. Safe to run anytime.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/bayesian-calibration-report.ts <user-id>
//
// Acceptance criteria for flipping v2 to UI (when you're ready to
// stop shadowing): observed coverage of stated 80% interval should
// be in the 75-85% band sustained across at least 30 events; observed
// coverage of stated 50% interval should be in the 45-55% band; per-
// event-name miss% should not regress materially against v1 on
// venues with N >= 10 events.

import { createClient } from "@supabase/supabase-js";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/bayesian-calibration-report.ts <user-id>");
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
const today = new Date().toISOString().slice(0, 10);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);
  if (error) {
    if ((error as { code?: string }).code === "42703") {
      console.error(
        "\nERROR: Bayesian shadow columns don't exist yet. Run migration\n" +
          "supabase/migrations/20260508000001_add_forecast_bayesian_shadow_columns.sql\n" +
          "in the Supabase SQL editor first, then trigger a recalc.\n"
      );
      process.exit(1);
    }
    throw error;
  }
  const allEvents = (data ?? []) as Event[];

  const eligible = allEvents.filter(
    (e) =>
      e.booked &&
      e.event_date < today &&
      (e.net_sales ?? 0) > 0 &&
      e.anomaly_flag !== "disrupted" &&
      e.anomaly_flag !== "boosted"
  );

  const haveV2 = eligible.filter(
    (e) =>
      e.forecast_bayesian_point != null &&
      e.forecast_bayesian_low_80 != null &&
      e.forecast_bayesian_high_80 != null
  );

  console.log(`\n${"=".repeat(78)}`);
  console.log(`BAYESIAN V2 CALIBRATION REPORT`);
  console.log(`User: ${userId}`);
  console.log(`Today: ${today}`);
  console.log(`Total events on file: ${allEvents.length}`);
  console.log(`Eligible past events with actuals: ${eligible.length}`);
  console.log(`Of which have v2 stored values: ${haveV2.length}`);
  console.log(`${"=".repeat(78)}`);

  if (haveV2.length === 0) {
    console.log(
      "\nNo events have v2 stored values yet. Either:\n" +
        "  1. The shadow-columns migration hasn't been applied (check\n" +
        "     supabase/migrations/20260508000001_*.sql).\n" +
        "  2. recalculateForUser hasn't run since the migration applied.\n" +
        "     Trigger one via the dashboard's Refresh Forecasts button or\n" +
        "     POST /api/recalculate.\n"
    );
    return;
  }

  // === Calibration coverage ===
  const within80 = haveV2.filter(
    (e) => e.net_sales! >= e.forecast_bayesian_low_80! && e.net_sales! <= e.forecast_bayesian_high_80!
  ).length;
  const within50 = haveV2.filter(
    (e) =>
      e.forecast_bayesian_low_50 != null &&
      e.forecast_bayesian_high_50 != null &&
      e.net_sales! >= e.forecast_bayesian_low_50 &&
      e.net_sales! <= e.forecast_bayesian_high_50
  ).length;

  console.log(`\n${"=".repeat(78)}`);
  console.log("CALIBRATION COVERAGE — observed rates vs stated intervals");
  console.log("=".repeat(78));
  console.log(
    `  Stated 80% interval, observed: ${within80}/${haveV2.length} (${((within80 / haveV2.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Stated 50% interval, observed: ${within50}/${haveV2.length} (${((within50 / haveV2.length) * 100).toFixed(1)}%)`
  );
  const cov80 = (within80 / haveV2.length) * 100;
  const cov50 = (within50 / haveV2.length) * 100;
  const verdict80 = cov80 >= 75 && cov80 <= 85 ? "OK" : cov80 < 75 ? "TIGHT (intervals too narrow)" : "LOOSE (intervals too wide)";
  const verdict50 = cov50 >= 45 && cov50 <= 55 ? "OK" : cov50 < 45 ? "TIGHT" : "LOOSE";
  console.log(`  80% verdict: ${verdict80}`);
  console.log(`  50% verdict: ${verdict50}`);

  // === Point accuracy ===
  console.log(`\n${"=".repeat(78)}`);
  console.log("POINT ESTIMATE ACCURACY — v1 vs v2 head-to-head");
  console.log("=".repeat(78));
  const haveBoth = haveV2.filter((e) => e.forecast_sales != null && e.forecast_sales > 0);

  function pointStats(rows: Event[], pickForecast: (e: Event) => number) {
    const misses = rows.map((e) => Math.abs((e.net_sales! - pickForecast(e)) / pickForecast(e)) * 100);
    const within20 = misses.filter((m) => m <= 20).length;
    const within30 = misses.filter((m) => m <= 30).length;
    const within50 = misses.filter((m) => m <= 50).length;
    const sorted = [...misses].sort((a, b) => a - b);
    return {
      n: rows.length,
      within20,
      within30,
      within50,
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      mean: misses.reduce((a, b) => a + b, 0) / Math.max(1, misses.length),
    };
  }

  const v1 = pointStats(haveBoth, (e) => e.forecast_sales!);
  const v2 = pointStats(haveBoth, (e) => e.forecast_bayesian_point!);
  console.log(
    `${"Metric".padEnd(28)}${"v1 (current prod)".padEnd(24)}${"v2 (Bayesian)"}`
  );
  console.log("-".repeat(78));
  console.log(`${"n (have both)".padEnd(28)}${String(v1.n).padEnd(24)}${v2.n}`);
  console.log(`${"Within ±20% flat".padEnd(28)}${`${v1.within20} (${(v1.within20/v1.n*100).toFixed(1)}%)`.padEnd(24)}${v2.within20} (${(v2.within20/v2.n*100).toFixed(1)}%)`);
  console.log(`${"Within ±30% flat".padEnd(28)}${`${v1.within30} (${(v1.within30/v1.n*100).toFixed(1)}%)`.padEnd(24)}${v2.within30} (${(v2.within30/v2.n*100).toFixed(1)}%)`);
  console.log(`${"Within ±50% flat".padEnd(28)}${`${v1.within50} (${(v1.within50/v1.n*100).toFixed(1)}%)`.padEnd(24)}${v2.within50} (${(v2.within50/v2.n*100).toFixed(1)}%)`);
  console.log(`${"|miss| median".padEnd(28)}${(v1.median.toFixed(1) + "%").padEnd(24)}${v2.median.toFixed(1)}%`);
  console.log(`${"|miss| mean".padEnd(28)}${(v1.mean.toFixed(1) + "%").padEnd(24)}${v2.mean.toFixed(1)}%`);

  // === Per-name breakdown ===
  console.log(`\n${"=".repeat(78)}`);
  console.log("PER-EVENT-NAME AVG |MISS| (n >= 5 events with both forecasts)");
  console.log("=".repeat(78));
  const byName = new Map<string, Event[]>();
  for (const e of haveBoth) {
    const k = e.event_name;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(e);
  }
  const rows: { name: string; n: number; v1: number; v2: number; delta: number }[] = [];
  for (const [name, set] of byName) {
    if (set.length < 5) continue;
    const v1Miss = set.map((e) => Math.abs((e.net_sales! - e.forecast_sales!) / e.forecast_sales!) * 100).reduce((a, b) => a + b, 0) / set.length;
    const v2Miss = set.map((e) => Math.abs((e.net_sales! - e.forecast_bayesian_point!) / e.forecast_bayesian_point!) * 100).reduce((a, b) => a + b, 0) / set.length;
    rows.push({ name, n: set.length, v1: v1Miss, v2: v2Miss, delta: v2Miss - v1Miss });
  }
  rows.sort((a, b) => b.n - a.n);
  console.log(`${"name".padEnd(38)}${"n".padEnd(5)}${"v1".padEnd(10)}${"v2".padEnd(10)}delta`);
  for (const r of rows.slice(0, 25)) {
    console.log(
      `${r.name.slice(0, 36).padEnd(38)}${String(r.n).padEnd(5)}${(r.v1.toFixed(0) + "%").padEnd(10)}${(r.v2.toFixed(0) + "%").padEnd(10)}${(r.delta > 0 ? "+" : "") + r.delta.toFixed(0)}pp`
    );
  }

  // === Prior source distribution ===
  console.log(`\n${"=".repeat(78)}`);
  console.log("V2 PRIOR-SOURCE DISTRIBUTION (which prior was used per forecast)");
  console.log("=".repeat(78));
  const priorCounts: Record<string, number> = {};
  for (const e of haveV2) {
    const k = e.forecast_bayesian_prior_src ?? "null";
    priorCounts[k] = (priorCounts[k] ?? 0) + 1;
  }
  for (const [src, count] of Object.entries(priorCounts)) {
    console.log(`  ${src.padEnd(12)}${count}  (${((count / haveV2.length) * 100).toFixed(1)}%)`);
  }

  // === Insufficient-data flagging comparison ===
  console.log(`\n${"=".repeat(78)}`);
  console.log("INSUFFICIENT-DATA FLAGGING");
  console.log("=".repeat(78));
  const v2Insuf = haveV2.filter((e) => e.forecast_bayesian_insufficient).length;
  console.log(`  v2 flagged insufficient: ${v2Insuf} of ${haveV2.length} (${((v2Insuf / haveV2.length) * 100).toFixed(1)}%)`);

  // === Staleness check ===
  console.log(`\n${"=".repeat(78)}`);
  console.log("STALENESS — when were v2 values last computed");
  console.log("=".repeat(78));
  const computedAts = haveV2
    .map((e) => e.forecast_bayesian_computed_at)
    .filter((t): t is string => t != null)
    .sort();
  if (computedAts.length > 0) {
    console.log(`  Earliest v2 write: ${computedAts[0]}`);
    console.log(`  Latest v2 write:   ${computedAts[computedAts.length - 1]}`);
    const oldestMs = Date.now() - new Date(computedAts[0]).getTime();
    const oldestDays = Math.round(oldestMs / (1000 * 60 * 60 * 24));
    if (oldestDays > 7) {
      console.log(`  WARNING: oldest v2 write is ${oldestDays} days old. Trigger a recalc to refresh.`);
    }
  }

  // === Acceptance check ===
  console.log(`\n${"=".repeat(78)}`);
  console.log("READINESS FOR V2 -> UI FLIP");
  console.log("=".repeat(78));
  const ready80 = cov80 >= 75 && cov80 <= 85;
  const ready50 = cov50 >= 45 && cov50 <= 55;
  const sample = haveV2.length >= 30;
  const pointParity = v2.within20 / v2.n >= v1.within20 / v1.n - 0.05; // v2 within 5pp of v1
  console.log(`  [${ready80 ? "OK" : "  "}] 80% interval coverage in 75-85% band  (${cov80.toFixed(1)}%)`);
  console.log(`  [${ready50 ? "OK" : "  "}] 50% interval coverage in 45-55% band  (${cov50.toFixed(1)}%)`);
  console.log(`  [${sample ? "OK" : "  "}] At least 30 events with v2 values      (${haveV2.length})`);
  console.log(`  [${pointParity ? "OK" : "  "}] v2 within 5pp of v1 on ±20% rate     (${(v2.within20/v2.n*100).toFixed(1)}% vs ${(v1.within20/v1.n*100).toFixed(1)}%)`);
  if (ready80 && ready50 && sample && pointParity) {
    console.log("\n  All criteria met — safe to consider flipping v2 to operator-facing UI.");
  } else {
    console.log("\n  Not yet ready. Continue shadow rollout and re-run this report weekly.");
  }
}
