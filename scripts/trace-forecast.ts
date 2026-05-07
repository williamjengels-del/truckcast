#!/usr/bin/env node
// Trace what the forecast engine WOULD HAVE produced for each past
// instance of an event_name, using leave-one-out historical context
// (mirroring the recalc backfill in src/lib/recalculate.ts).
//
// Layer 2 of the engine-fix plan: 9 Mile Garden has 28 logged instances
// in Wok-O Taco's history but the engine averages 109% miss on it.
// Theories from v42 brief §6:
//   1. Calibration coefficient mean-reverting too aggressively
//   2. Cross-operator blending dragging toward platform medians
//   3. Leave-one-out backfill diverging from live forward forecasts
//   4. Forecast level (L1/L2/L3/L0) selection picking wrong
//   5. No time decay within a single event_name's history
//
// This script logs, for each past event in the series:
//   - chosen level + dataPoints
//   - calibrated true/false
//   - platform blend weight + operator count + median
//   - weather + day-of-week coefficients
//   - venue familiarity applied
//   - confidence score + label
//   - final forecast
//   - actual sales + miss%
//
// Usage:
//   node --env-file=.env.local scripts/trace-forecast.ts <user-id> "<event-name>"
//
// Read-only. Service-role client used to bypass RLS for the operator's
// own data. Doesn't write anything.

import { createClient } from "@supabase/supabase-js";
import {
  calculateForecast,
  calibrateCoefficients,
  computeOperatorOverallMedian,
} from "../src/lib/forecast-engine.ts";
import {
  getPlatformEventsExcludingUser,
} from "../src/lib/platform-registry.ts";
import type { Event } from "../src/lib/database.types.ts";

const argv = process.argv.slice(2);
const userId = argv[0];
const eventName = argv[1];

if (!userId || !eventName) {
  console.error('Usage: node --env-file=.env.local scripts/trace-forecast.ts <user-id> "<event-name>"');
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

if (error) {
  console.error("Query failed:", error);
  process.exit(1);
}

const allEvents = (rawEvents ?? []) as Event[];

// All events with this name (case-insensitive), past + future
const targetName = eventName.toLowerCase().trim();
const seriesEvents = allEvents.filter(
  (e) => e.event_name.toLowerCase().trim() === targetName
);

if (seriesEvents.length === 0) {
  console.error(`No events with name matching "${eventName}" found for user.`);
  console.error(`Closest matches in operator history:`);
  const sample = [...new Set(allEvents.map((e) => e.event_name))]
    .filter((n) => n.toLowerCase().includes(targetName.slice(0, 5)))
    .slice(0, 10);
  for (const n of sample) console.error(`  ${n}`);
  process.exit(1);
}

// Calibrated coefficients across the operator's full history. The recalc
// pipeline computes these from allEvents (no leave-one-out at the
// calibration layer). We mirror that here.
const calibrated = calibrateCoefficients(allEvents);
const operatorMedian = computeOperatorOverallMedian(allEvents);

// Pull platform aggregates for this event name. Self-excluded — same
// pipeline path as recalc.ts uses.
const platformMap = await getPlatformEventsExcludingUser([eventName], userId).catch(() => new Map() as Map<string, unknown>);
const platformEvent = platformMap.get(targetName) ?? null;

console.log(`\n${"=".repeat(80)}`);
console.log(`TRACE — "${eventName}" for user ${userId}`);
console.log(`${"=".repeat(80)}`);
console.log(`Total events with this name: ${seriesEvents.length}`);
console.log(`Operator overall median revenue: $${operatorMedian.toFixed(0)}`);
console.log(
  `Calibrated coefficients: ${calibrated ? `yes (n=${calibrated.eventCount}, overallAvg=$${calibrated.overallAvg.toFixed(0)})` : "no (insufficient history)"}`
);
console.log(
  `Platform aggregate: ${platformEvent ? `${(platformEvent as { operator_count: number }).operator_count} other operators, median $${((platformEvent as { median_sales: number | null }).median_sales ?? 0).toFixed(0)}` : "none"}`
);
console.log(`${"=".repeat(80)}\n`);

// For each past instance, simulate what the engine would have forecast
// at the time, using the leave-one-out historical context.
type Row = {
  date: string;
  actual: number;
  forecast: number | null;
  level: number | null;
  levelName: string | null;
  dataPoints: number | null;
  calibrated: boolean | null;
  platformBlend: boolean | null;
  platformOps: number | null;
  platformMedian: number | null;
  venueFamiliar: boolean | null;
  weatherCoeff: number | null;
  dowCoeff: number | null;
  confidence: string | null;
  confidenceScore: number | null;
  insufficient: boolean | null;
  missPct: number | null;
};

const rows: Row[] = [];

const past = seriesEvents
  .filter(
    (e) =>
      e.event_date < today &&
      e.booked &&
      e.net_sales !== null &&
      e.net_sales > 0 &&
      e.anomaly_flag !== "disrupted"
  )
  .sort((a, b) => a.event_date.localeCompare(b.event_date));

for (const event of past) {
  const historicalWithout = allEvents.filter((e) => e.id !== event.id);
  const result = calculateForecast(event, historicalWithout, {
    calibratedCoefficients: calibrated,
    platformEvent,
  });
  const actual = event.net_sales!;
  rows.push({
    date: event.event_date,
    actual,
    forecast: result?.forecast ?? null,
    level: result?.level ?? null,
    levelName: result?.levelName ?? null,
    dataPoints: result?.dataPoints ?? null,
    calibrated: result?.calibrated ?? null,
    platformBlend: result?.platformBlendApplied ?? null,
    platformOps: result?.platformOperatorCount ?? null,
    platformMedian: result?.platformMedianSales ?? null,
    venueFamiliar: result?.venueFamiliarityApplied ?? null,
    weatherCoeff: result?.weatherCoefficient ?? null,
    dowCoeff: result?.dayOfWeekCoefficient ?? null,
    confidence: result?.confidence ?? null,
    confidenceScore: result?.confidenceScore ?? null,
    insufficient: result?.insufficientData ?? null,
    missPct: result && result.forecast > 0 ? ((actual - result.forecast) / result.forecast) * 100 : null,
  });
}

// Summary table
function pad(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str.slice(0, w) : str + " ".repeat(w - str.length);
}
function num(n: number | null, d = 0, w = 7): string {
  if (n === null || n === undefined || Number.isNaN(n)) return pad("—", w);
  return pad(n.toFixed(d), w);
}

console.log(
  pad("date", 11) +
    pad("L", 3) +
    pad("n", 4) +
    pad("calib", 6) +
    pad("blend", 6) +
    pad("plat", 5) +
    pad("vnu", 4) +
    pad("wthr", 6) +
    pad("dow", 6) +
    pad("conf", 6) +
    pad("score", 6) +
    pad("forecast", 10) +
    pad("actual", 10) +
    pad("miss%", 8) +
    "ins"
);
console.log("-".repeat(95));

let absMissTotal = 0;
let absMissCount = 0;
for (const r of rows) {
  console.log(
    pad(r.date, 11) +
      pad(r.level ?? "—", 3) +
      pad(r.dataPoints ?? "—", 4) +
      pad(r.calibrated ? "Y" : r.calibrated === false ? "N" : "—", 6) +
      pad(r.platformBlend ? "Y" : r.platformBlend === false ? "N" : "—", 6) +
      pad(r.platformOps ?? "—", 5) +
      pad(r.venueFamiliar ? "Y" : r.venueFamiliar === false ? "N" : "—", 4) +
      num(r.weatherCoeff, 2, 6) +
      num(r.dowCoeff, 2, 6) +
      pad(r.confidence ?? "—", 6) +
      num(r.confidenceScore, 2, 6) +
      pad(r.forecast !== null ? "$" + Math.round(r.forecast) : "—", 10) +
      pad("$" + Math.round(r.actual), 10) +
      num(r.missPct, 0, 8) +
      (r.insufficient ? " *" : "")
  );
  if (r.missPct !== null) {
    absMissTotal += Math.abs(r.missPct);
    absMissCount++;
  }
}

console.log("-".repeat(95));
console.log(`\nSummary:`);
console.log(`  Past events traced: ${rows.length}`);
console.log(`  Avg |miss|:         ${absMissCount > 0 ? (absMissTotal / absMissCount).toFixed(1) + "%" : "n/a"}`);

const insufficient = rows.filter((r) => r.insufficient).length;
console.log(`  Flagged insufficient-data: ${insufficient}`);

// Level distribution
const levelCounts: Record<string, number> = {};
for (const r of rows) {
  const k = r.level === null ? "null" : `L${r.level}`;
  levelCounts[k] = (levelCounts[k] ?? 0) + 1;
}
console.log(`  Level distribution: ${Object.entries(levelCounts).map(([k, v]) => `${k}=${v}`).join(" ")}`);

// Direction
const overs = rows.filter((r) => r.missPct !== null && r.missPct > 0).length;
const unders = rows.filter((r) => r.missPct !== null && r.missPct < 0).length;
console.log(`  Direction: ${overs} over / ${unders} under`);

// Forecast trend over time (does the engine learn as data accumulates?)
console.log(`\nForecast vs actual time series:`);
for (const r of rows) {
  const bar = r.forecast !== null && r.actual > 0
    ? "#".repeat(Math.min(40, Math.round((r.forecast / r.actual) * 20)))
    : "";
  console.log(
    `  ${r.date}  forecast=${pad("$" + Math.round(r.forecast ?? 0), 8)} actual=${pad("$" + Math.round(r.actual), 8)}  ${bar}`
  );
}
} // end main
