#!/usr/bin/env node
// Head-to-head comparison: v1 (current production engine) vs v2
// (Bayesian conjugate log-Normal). Runs both engines against an
// operator's full past-event history using leave-one-out, then
// reports calibration metrics and per-name miss% deltas.
//
// Read-only. No DB writes. Uses service-role key to bypass RLS.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/compare-engines.ts <user-id>
//
// What "good" looks like for v2:
//   - Within stated 80% credible interval rate close to 80%
//   - Within stated 50% interval rate close to 50%
//   - Per-name avg |miss| not regressing materially against v1
//   - Calibration honesty (interval coverage matches stated %)
//   - Reasonable insufficient-data flagging

import { createClient } from "@supabase/supabase-js";
import {
  calculateForecast,
  calibrateCoefficients,
} from "../src/lib/forecast-engine.ts";
import {
  calculateBayesianForecast,
  type BayesianForecastResult,
} from "../src/lib/forecast-engine-v2.ts";
import { getPlatformEventsExcludingUser } from "../src/lib/platform-registry.ts";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/compare-engines.ts <user-id>");
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
  const { data: rawEvents, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  const allEvents = (rawEvents ?? []) as Event[];

  function isFixedRevenueEvent(e: Event): boolean {
    if (e.event_mode === "catering") return true;
    if ((e.invoice_revenue ?? 0) > 0) return true;
    if (e.fee_type === "pre_settled") return true;
    if (e.fee_type === "commission_with_minimum" && (e.sales_minimum ?? 0) > 0) return true;
    return false;
  }

  // Same eligibility as audit-forecast-deep.mjs
  const eligible = allEvents.filter(
    (e) =>
      e.booked &&
      e.event_date < today &&
      (e.net_sales ?? 0) > 0 &&
      e.anomaly_flag !== "disrupted" &&
      e.anomaly_flag !== "boosted"
  );

  const calibrated = calibrateCoefficients(allEvents);
  const allNames = [...new Set(eligible.map((e) => e.event_name))];
  const platformMap = await getPlatformEventsExcludingUser(allNames, userId).catch(
    () => new Map() as Map<string, unknown>
  );

  type Row = {
    name: string;
    date: string;
    actual: number;
    isFixed: boolean;
    // v1
    v1Forecast: number | null;
    v1Low: number | null;
    v1High: number | null;
    v1Insufficient: boolean;
    // v2
    v2Point: number | null;
    v2Low80: number | null;
    v2High80: number | null;
    v2Low50: number | null;
    v2High50: number | null;
    v2Insufficient: boolean;
    v2N: number;
    v2PriorSource: BayesianForecastResult["priorSource"] | null;
  };

  const rows: Row[] = [];

  for (const event of eligible) {
    const historicalWithout = allEvents.filter((e) => e.id !== event.id);
    const platformEvent =
      (platformMap.get(event.event_name.toLowerCase().trim()) as
        | { median_sales: number | null; operator_count: number; total_instances: number }
        | undefined) ?? null;

    // v1
    const v1 = calculateForecast(event, historicalWithout, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    const v1Score = v1?.confidenceScore ?? 0;
    const v1Pct = v1Score >= 0.65 ? 0.30 : v1Score >= 0.4 ? 0.50 : 0.80;
    const v1Forecast = v1?.insufficientData ? null : v1?.forecast ?? null;
    const v1Low = v1Forecast !== null ? v1Forecast * (1 - v1Pct) : null;
    const v1High = v1Forecast !== null ? v1Forecast * (1 + v1Pct) : null;

    // v2
    const v2 = calculateBayesianForecast(event, historicalWithout, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    const v2Point = v2?.insufficientData ? null : v2?.point ?? null;

    rows.push({
      name: event.event_name,
      date: event.event_date,
      actual: event.net_sales!,
      isFixed: isFixedRevenueEvent(event),
      v1Forecast,
      v1Low,
      v1High,
      v1Insufficient: v1?.insufficientData ?? false,
      v2Point,
      v2Low80: v2?.insufficientData ? null : v2?.credibleLow ?? null,
      v2High80: v2?.insufficientData ? null : v2?.credibleHigh ?? null,
      v2Low50: v2?.insufficientData ? null : v2?.credible50Low ?? null,
      v2High50: v2?.insufficientData ? null : v2?.credible50High ?? null,
      v2Insufficient: v2?.insufficientData ?? false,
      v2N: v2?.personalObservations ?? 0,
      v2PriorSource: v2?.priorSource ?? null,
    });
  }

  // === Aggregate metrics ===

  function aggV1(set: Row[]) {
    const haveForecast = set.filter((r) => r.v1Forecast !== null);
    if (haveForecast.length === 0) return null;
    const misses = haveForecast.map((r) => Math.abs((r.actual - r.v1Forecast!) / r.v1Forecast!) * 100);
    return {
      n: haveForecast.length,
      within20: haveForecast.filter((r) => Math.abs((r.actual - r.v1Forecast!) / r.v1Forecast!) * 100 <= 20).length,
      within30: haveForecast.filter((r) => Math.abs((r.actual - r.v1Forecast!) / r.v1Forecast!) * 100 <= 30).length,
      within50: haveForecast.filter((r) => Math.abs((r.actual - r.v1Forecast!) / r.v1Forecast!) * 100 <= 50).length,
      withinRange: haveForecast.filter((r) =>
        r.v1Low !== null && r.v1High !== null && r.actual >= r.v1Low && r.actual <= r.v1High
      ).length,
      medianMiss: median(misses),
      meanMiss: misses.reduce((a, b) => a + b, 0) / misses.length,
    };
  }

  function aggV2(set: Row[]) {
    const haveForecast = set.filter((r) => r.v2Point !== null);
    if (haveForecast.length === 0) return null;
    const misses = haveForecast.map((r) => Math.abs((r.actual - r.v2Point!) / r.v2Point!) * 100);
    return {
      n: haveForecast.length,
      within20: haveForecast.filter((r) => Math.abs((r.actual - r.v2Point!) / r.v2Point!) * 100 <= 20).length,
      within30: haveForecast.filter((r) => Math.abs((r.actual - r.v2Point!) / r.v2Point!) * 100 <= 30).length,
      within50: haveForecast.filter((r) => Math.abs((r.actual - r.v2Point!) / r.v2Point!) * 100 <= 50).length,
      // v2 reports 80% credible interval — coverage rate should be ~80%
      within80Credible: haveForecast.filter((r) =>
        r.v2Low80 !== null && r.v2High80 !== null && r.actual >= r.v2Low80 && r.actual <= r.v2High80
      ).length,
      // v2 also reports 50% interval — coverage rate should be ~50%
      within50Credible: haveForecast.filter((r) =>
        r.v2Low50 !== null && r.v2High50 !== null && r.actual >= r.v2Low50 && r.actual <= r.v2High50
      ).length,
      medianMiss: median(misses),
      meanMiss: misses.reduce((a, b) => a + b, 0) / misses.length,
    };
  }

  function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function pct(num: number, den: number): string {
    if (den === 0) return "n/a";
    return `${num}/${den} (${((num / den) * 100).toFixed(1)}%)`;
  }

  function reportSection(label: string, rows: Row[]) {
    console.log(`\n${"=".repeat(82)}`);
    console.log(label + `  (n=${rows.length})`);
    console.log("=".repeat(82));
    const v1 = aggV1(rows);
    const v2 = aggV2(rows);
    if (!v1 || !v2) {
      console.log("(empty)");
      return;
    }
    console.log(
      `${"Metric".padEnd(32)}${"v1 (current prod)".padEnd(24)}${"v2 (Bayesian)"}`
    );
    console.log("-".repeat(82));
    console.log(`${"Eligible rows".padEnd(32)}${String(v1.n).padEnd(24)}${v2.n}`);
    console.log(`${"Within ±20% flat".padEnd(32)}${pct(v1.within20, v1.n).padEnd(24)}${pct(v2.within20, v2.n)}`);
    console.log(`${"Within ±30% flat".padEnd(32)}${pct(v1.within30, v1.n).padEnd(24)}${pct(v2.within30, v2.n)}`);
    console.log(`${"Within ±50% flat".padEnd(32)}${pct(v1.within50, v1.n).padEnd(24)}${pct(v2.within50, v2.n)}`);
    console.log(`${"Within stated range".padEnd(32)}${pct(v1.withinRange, v1.n).padEnd(24)}—`);
    console.log(`${"Within 80% credible (v2)".padEnd(32)}${"—".padEnd(24)}${pct(v2.within80Credible, v2.n)}`);
    console.log(`${"Within 50% credible (v2)".padEnd(32)}${"—".padEnd(24)}${pct(v2.within50Credible, v2.n)}`);
    console.log(`${"|miss| median".padEnd(32)}${(v1.medianMiss.toFixed(1) + "%").padEnd(24)}${v2.medianMiss.toFixed(1)}%`);
    console.log(`${"|miss| mean".padEnd(32)}${(v1.meanMiss.toFixed(1) + "%").padEnd(24)}${v2.meanMiss.toFixed(1)}%`);
  }

  reportSection("ALL ELIGIBLE", rows);
  reportSection("EXCLUDING fixed-revenue rows", rows.filter((r) => !r.isFixed));

  // Per-name comparison for high-frequency venues
  const targetNames = new Set([
    "9 Mile Garden",
    "Scott Air Force Base",
    "Charter St Ann",
    "Wellspent Brewery",
    "Hidden Gems Bar",
    "Chesterfield Amphitheater",
    "Lunchtime Live",
    "Best of Missouri Market",
  ]);

  console.log(`\n${"=".repeat(82)}`);
  console.log("PER-NAME AVG |MISS| — v1 vs v2");
  console.log("=".repeat(82));
  console.log(`${"name".padEnd(32)}${"n".padEnd(5)}${"v1".padEnd(10)}${"v2".padEnd(10)}delta`);
  for (const name of [...targetNames]) {
    const set = rows.filter((r) => r.name === name);
    if (set.length === 0) continue;
    const v1Set = set.filter((r) => r.v1Forecast !== null);
    const v2Set = set.filter((r) => r.v2Point !== null);
    const v1Miss = v1Set.length > 0
      ? v1Set.map((r) => Math.abs((r.actual - r.v1Forecast!) / r.v1Forecast!) * 100).reduce((a, b) => a + b, 0) / v1Set.length
      : 0;
    const v2Miss = v2Set.length > 0
      ? v2Set.map((r) => Math.abs((r.actual - r.v2Point!) / r.v2Point!) * 100).reduce((a, b) => a + b, 0) / v2Set.length
      : 0;
    const delta = v2Miss - v1Miss;
    console.log(
      `${name.padEnd(32)}${String(set.length).padEnd(5)}${(v1Miss.toFixed(0) + "%").padEnd(10)}${(v2Miss.toFixed(0) + "%").padEnd(10)}${(delta > 0 ? "+" : "") + delta.toFixed(0)}pp`
    );
  }

  // v2 prior source distribution
  const priorCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.v2PriorSource) {
      priorCounts[r.v2PriorSource] = (priorCounts[r.v2PriorSource] ?? 0) + 1;
    }
  }
  console.log(`\nv2 prior-source distribution:`);
  for (const [src, count] of Object.entries(priorCounts)) {
    console.log(`  ${src.padEnd(12)}${count}`);
  }

  // Insufficient-data flagging
  const v1Flagged = rows.filter((r) => r.v1Insufficient).length;
  const v2Flagged = rows.filter((r) => r.v2Insufficient).length;
  console.log(`\nInsufficient-data flagged:  v1=${v1Flagged}  v2=${v2Flagged}  (of ${rows.length} total)`);

  // Calibration honesty check — if v2 says "80% interval" we want
  // observed coverage close to 80%. Print the gap.
  const v2Cov80 = rows.filter((r) => r.v2Point !== null && r.v2Low80 !== null && r.actual >= r.v2Low80 && r.actual <= r.v2High80!).length;
  const v2Cov50 = rows.filter((r) => r.v2Point !== null && r.v2Low50 !== null && r.actual >= r.v2Low50 && r.actual <= r.v2High50!).length;
  const v2Total = rows.filter((r) => r.v2Point !== null).length;
  console.log(`\nv2 calibration honesty:`);
  console.log(`  Stated 80% interval, observed: ${(v2Cov80 / v2Total * 100).toFixed(1)}%  (gap: ${(80 - v2Cov80 / v2Total * 100).toFixed(1)}pp)`);
  console.log(`  Stated 50% interval, observed: ${(v2Cov50 / v2Total * 100).toFixed(1)}%  (gap: ${(50 - v2Cov50 / v2Total * 100).toFixed(1)}pp)`);

  // Top 10 events where v2 is materially worse than v1 (regression check)
  console.log(`\n${"=".repeat(82)}`);
  console.log("REGRESSIONS — events where v2 is materially worse than v1 (top 10)");
  console.log("=".repeat(82));
  const regressions = rows
    .filter((r) => r.v1Forecast !== null && r.v2Point !== null && !r.isFixed)
    .map((r) => ({
      ...r,
      v1Miss: Math.abs((r.actual - r.v1Forecast!) / r.v1Forecast!) * 100,
      v2Miss: Math.abs((r.actual - r.v2Point!) / r.v2Point!) * 100,
    }))
    .map((r) => ({ ...r, diff: r.v2Miss - r.v1Miss }))
    .sort((a, b) => b.diff - a.diff);
  for (const r of regressions.slice(0, 10)) {
    console.log(
      `  ${r.date}  v1=${("$" + Math.round(r.v1Forecast!)).padStart(7)} (${r.v1Miss.toFixed(0)}%)  ` +
        `v2=${("$" + Math.round(r.v2Point!)).padStart(7)} (${r.v2Miss.toFixed(0)}%)  ` +
        `actual=${("$" + Math.round(r.actual)).padStart(7)}  ${r.name}`
    );
  }
}
