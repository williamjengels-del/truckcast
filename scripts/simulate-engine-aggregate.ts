#!/usr/bin/env node
// Simulate the live engine across an operator's full past-event history
// and report projected audit stats. Mirrors what audit-forecast-deep.mjs
// would show AFTER the next prod recalc has rewritten stored values.
//
// Two scenarios are reported side-by-side:
//   STORED  — current values from the events table (what the live audit shows)
//   ENGINE  — what calculateForecast produces today, leave-one-out
//
// Read-only. Uses service-role to bypass RLS for the operator's data.
//
// Usage:
//   npx tsx scripts/simulate-engine-aggregate.ts <user-id>

import { createClient } from "@supabase/supabase-js";
import {
  calculateForecast,
  calibrateCoefficients,
} from "../src/lib/forecast-engine.ts";
import { getPlatformEventsExcludingUser } from "../src/lib/platform-registry.ts";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/simulate-engine-aggregate.ts <user-id>");
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

  // Current eligibility: same as audit-forecast-deep.mjs's isEligible.
  function isFixedRevenueEvent(e: Event): boolean {
    if (e.event_mode === "catering") return true;
    if ((e.invoice_revenue ?? 0) > 0) return true;
    if (e.fee_type === "pre_settled") return true;
    if (e.fee_type === "commission_with_minimum" && (e.sales_minimum ?? 0) > 0) return true;
    return false;
  }
  const eligible = allEvents.filter(
    (e) =>
      e.booked &&
      e.event_date < today &&
      (e.net_sales ?? 0) > 0 &&
      e.anomaly_flag !== "disrupted" &&
      e.anomaly_flag !== "boosted"
  );

  const calibrated = calibrateCoefficients(allEvents);

  // Pull platform aggregates for every name we'll forecast against.
  const allNames = [...new Set(eligible.map((e) => e.event_name))];
  const platformMap = await getPlatformEventsExcludingUser(allNames, userId).catch(
    () => new Map() as Map<string, unknown>
  );

  type Snapshot = {
    name: string;
    actual: number;
    storedForecast: number | null;
    storedLow: number | null;
    storedHigh: number | null;
    engineForecast: number | null;
    engineLow: number | null;
    engineHigh: number | null;
    engineInsufficient: boolean;
  };
  const snapshots: Snapshot[] = [];

  for (const event of eligible) {
    const historicalWithout = allEvents.filter((e) => e.id !== event.id);
    const platformEvent =
      (platformMap.get(event.event_name.toLowerCase().trim()) as
        | { median_sales: number | null; operator_count: number; total_instances: number }
        | undefined) ?? null;
    const result = calculateForecast(event, historicalWithout, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    const score = result?.confidenceScore ?? 0;
    const pct = score >= 0.65 ? 0.30 : score >= 0.4 ? 0.50 : 0.80;
    const engineForecast = result?.insufficientData
      ? null
      : result?.forecast ?? null;
    const engineLow = engineForecast !== null ? engineForecast * (1 - pct) : null;
    const engineHigh = engineForecast !== null ? engineForecast * (1 + pct) : null;
    snapshots.push({
      name: event.event_name,
      actual: event.net_sales!,
      storedForecast: event.forecast_sales,
      storedLow: event.forecast_low,
      storedHigh: event.forecast_high,
      engineForecast,
      engineLow,
      engineHigh,
      engineInsufficient: result?.insufficientData ?? false,
    });
  }

  function aggStored(rows: Snapshot[]) {
    const eligibleRows = rows.filter(
      (r) => r.storedForecast !== null && r.storedForecast > 0
    );
    return aggregate(eligibleRows.map((r) => ({ actual: r.actual, forecast: r.storedForecast!, low: r.storedLow, high: r.storedHigh })), eligibleRows.length, rows.length);
  }
  function aggEngine(rows: Snapshot[]) {
    const eligibleRows = rows.filter(
      (r) => r.engineForecast !== null && r.engineForecast > 0
    );
    return aggregate(eligibleRows.map((r) => ({ actual: r.actual, forecast: r.engineForecast!, low: r.engineLow, high: r.engineHigh })), eligibleRows.length, rows.length);
  }

  function aggregate(
    eligibleRows: { actual: number; forecast: number; low: number | null; high: number | null }[],
    n: number,
    totalCandidate: number
  ) {
    if (n === 0) {
      return { n, totalCandidate, within20: 0, within30: 0, within50: 0, withinRange: 0, medianMiss: 0, meanDir: 0 };
    }
    const misses = eligibleRows.map((r) => Math.abs((r.actual - r.forecast) / r.forecast) * 100);
    const within20 = misses.filter((m) => m <= 20).length;
    const within30 = misses.filter((m) => m <= 30).length;
    const within50 = misses.filter((m) => m <= 50).length;
    const withinRange = eligibleRows.filter((r) =>
      r.low !== null && r.high !== null && r.actual >= r.low && r.actual <= r.high
    ).length;
    const sorted = [...misses].sort((a, b) => a - b);
    const medianMiss = sorted[Math.floor(sorted.length / 2)];
    const dirs = eligibleRows.map((r) => ((r.actual - r.forecast) / r.forecast) * 100);
    const meanDir = dirs.reduce((a, b) => a + b, 0) / dirs.length;
    return { n, totalCandidate, within20, within30, within50, withinRange, medianMiss, meanDir };
  }

  function pctStr(num: number, den: number): string {
    if (den === 0) return "n/a";
    return `${num}/${den} (${((num / den) * 100).toFixed(1)}%)`;
  }

  const eligibleNoFixed = snapshots.filter((s) => {
    const e = eligible.find((ev) => ev.event_name === s.name && ev.net_sales === s.actual);
    return e ? !isFixedRevenueEvent(e) : true;
  });

  function printSection(label: string, rows: Snapshot[]) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`${label}  (candidate n=${rows.length})`);
    console.log("=".repeat(78));
    const stored = aggStored(rows);
    const engine = aggEngine(rows);
    console.log(
      `${"".padEnd(28)}${"STORED (current prod)".padEnd(26)}${"ENGINE (post-fix sim)"}`
    );
    console.log(`Eligible rows               ${String(stored.n).padEnd(26)}${engine.n}`);
    console.log(`Within ±20% flat            ${pctStr(stored.within20, stored.n).padEnd(26)}${pctStr(engine.within20, engine.n)}`);
    console.log(`Within ±30% flat            ${pctStr(stored.within30, stored.n).padEnd(26)}${pctStr(engine.within30, engine.n)}`);
    console.log(`Within ±50% flat            ${pctStr(stored.within50, stored.n).padEnd(26)}${pctStr(engine.within50, engine.n)}`);
    console.log(`Within engine stated range  ${pctStr(stored.withinRange, stored.n).padEnd(26)}${pctStr(engine.withinRange, engine.n)}`);
    console.log(`|miss| median               ${stored.medianMiss.toFixed(1).padEnd(26)}${engine.medianMiss.toFixed(1)}`);
    console.log(`Mean directional miss       ${stored.meanDir.toFixed(1).padEnd(26)}${engine.meanDir.toFixed(1)}`);
  }

  printSection("ALL ELIGIBLE", snapshots);
  printSection("EXCLUDING fixed-revenue rows", eligibleNoFixed);

  // Per-event-name comparison for high-frequency venues
  const targetNames = new Set([
    "9 Mile Garden",
    "Scott Air Force Base",
    "Charter St Ann",
    "Wellspent Brewery",
    "Hidden Gems Bar",
    "Chesterfield Amphitheater",
    "Lunchtime Live",
  ]);
  console.log(`\n${"=".repeat(78)}`);
  console.log("PER-NAME AVG |MISS|  (high-frequency venues)");
  console.log("=".repeat(78));
  console.log(`${"name".padEnd(36)}n   STORED   ENGINE   delta`);
  for (const name of [...targetNames]) {
    const rows = snapshots.filter((s) => s.name === name);
    if (rows.length === 0) continue;
    const storedRows = rows.filter((r) => r.storedForecast !== null && r.storedForecast > 0);
    const engineRows = rows.filter((r) => r.engineForecast !== null && r.engineForecast > 0);
    const storedMiss =
      storedRows.length > 0
        ? storedRows
            .map((r) => Math.abs((r.actual - r.storedForecast!) / r.storedForecast!) * 100)
            .reduce((a, b) => a + b, 0) / storedRows.length
        : 0;
    const engineMiss =
      engineRows.length > 0
        ? engineRows
            .map((r) => Math.abs((r.actual - r.engineForecast!) / r.engineForecast!) * 100)
            .reduce((a, b) => a + b, 0) / engineRows.length
        : 0;
    const delta = engineMiss - storedMiss;
    console.log(
      `${name.padEnd(36)}${String(rows.length).padEnd(4)}${(storedMiss.toFixed(0) + "%").padEnd(9)}${(engineMiss.toFixed(0) + "%").padEnd(9)}${(delta > 0 ? "+" : "") + delta.toFixed(0)}pp`
    );
  }

  // Insufficient-data flagged count
  const flagged = snapshots.filter((s) => s.engineInsufficient).length;
  console.log(`\nEngine flagged insufficient-data: ${flagged} of ${snapshots.length}`);
}
