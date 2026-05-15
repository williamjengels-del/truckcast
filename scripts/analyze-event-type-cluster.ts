#!/usr/bin/env node
// Analysis script for the engine Tier-2 planning brief Workstream A
// (event-type-clustered priors).
//
// Question this script answers:
//   "For an operator, does using the same-event-TYPE median as the prior
//   produce a better-calibrated forecast than using the operator's
//   overall median, for events with thin same-event-NAME history?"
//
// This is the simplest measurement that informs the 5 decisions in
// `Briefs/vendcast_planning_engine-tier2-moves_2026-05-14.md` without
// modifying production code. If type-cluster prior produces materially
// lower median |miss| than operator-overall prior on thin-data events,
// that's evidence to invest in the full v2 engine extension.
//
// Read-only. Service-role client. Safe to run anytime.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/analyze-event-type-cluster.ts <user-id>
//
// Optional second arg: a target event_type to focus the report.

import { createClient } from "@supabase/supabase-js";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const focusType = process.argv[3] ?? null;

if (!userId) {
  console.error(
    "Usage: npx tsx scripts/analyze-event-type-cluster.ts <user-id> [event_type]"
  );
  process.exit(2);
}

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

const today = new Date().toISOString().slice(0, 10);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Helpers ─────────────────────────────────────────────────────────

function eventRevenue(e: Event): number {
  const ns = e.net_sales ?? 0;
  const ir = e.event_mode === "catering" ? e.invoice_revenue ?? 0 : 0;
  return ns + ir;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normalizeEventType(t: string | null | undefined): string {
  if (!t) return "";
  return t.trim().toLowerCase();
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Main ────────────────────────────────────────────────────────────

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;

  const allEvents = (data ?? []) as Event[];

  // Eligible past events with actuals — same filter pattern as
  // bayesian-calibration-report.ts and compare-engines.ts.
  const eligible = allEvents.filter(
    (e) =>
      e.booked &&
      e.event_date < today &&
      eventRevenue(e) > 0 &&
      e.anomaly_flag !== "disrupted" &&
      e.anomaly_flag !== "boosted"
  );

  console.log("\n" + "=".repeat(78));
  console.log("EVENT-TYPE CLUSTER PRIOR ANALYSIS");
  console.log(`User: ${userId}`);
  console.log(`Today: ${today}`);
  console.log(`Total events on file: ${allEvents.length}`);
  console.log(`Eligible past events with actuals: ${eligible.length}`);
  if (focusType) console.log(`Focus event_type: ${focusType}`);
  console.log("=".repeat(78));

  if (eligible.length < 10) {
    console.log(
      "\nFewer than 10 eligible events — analysis is too thin to be informative.\n"
    );
    return;
  }

  // Operator-overall median (precomputed once, leave-one-out applied
  // per row below).
  const allRevenues = eligible.map(eventRevenue);
  const overallMedian = median(allRevenues);
  console.log(
    `\nOperator overall median revenue (full set): $${overallMedian.toFixed(0)}`
  );

  // Group by event_type and by event_name for the leave-one-out work.
  const byType = new Map<string, Event[]>();
  const byName = new Map<string, Event[]>();
  for (const e of eligible) {
    const t = normalizeEventType(e.event_type);
    if (t) {
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(e);
    }
    const n = e.event_name?.trim().toLowerCase() ?? "";
    if (n) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n)!.push(e);
    }
  }

  // Per-event-type prior summary.
  console.log("\n--- Per-event-type aggregate ---");
  console.log(
    `${"event_type".padEnd(28)}${"count".padStart(8)}${"median $".padStart(12)}`
  );
  for (const [t, evts] of [...byType.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )) {
    const m = median(evts.map(eventRevenue));
    console.log(
      `${t.padEnd(28)}${String(evts.length).padStart(8)}${("$" + m.toFixed(0)).padStart(12)}`
    );
  }

  // The headline comparison: for each eligible event, simulate
  // "what if we'd used the type-cluster prior instead of the
  // operator-overall prior" and compute miss%.
  //
  // Leave-one-out: when computing the prior FOR event X, exclude X
  // from the data feeding the prior. Otherwise the "prior" includes
  // the actual outcome we're trying to predict, which inflates the
  // type-cluster signal artificially.
  //
  // We restrict to "thin same-name data" events — operators with
  // fewer than 3 prior observations of this specific event_name.
  // Those are exactly the events the engine planning brief
  // identified as the type-cluster's natural target.
  console.log("\n--- Calibration on THIN-SAME-NAME events (n_same_name < 3) ---");

  const thinSet = eligible.filter((e) => {
    const n = e.event_name?.trim().toLowerCase() ?? "";
    const sameName = byName.get(n) ?? [];
    const priors = sameName.filter(
      (other) => other.event_date < e.event_date && other.id !== e.id
    );
    return priors.length < 3;
  });

  if (thinSet.length === 0) {
    console.log(
      "\nNo thin-same-name events. Operator has 3+ same-name history on every event."
    );
    console.log(
      "Event-type clustering would not move the needle here — the per-name posterior already dominates."
    );
    return;
  }

  console.log(`Eligible thin-same-name rows: ${thinSet.length}`);

  // For each thin event:
  //   miss_overall = |actual - overall_median_LOO| / actual
  //   miss_type    = |actual - type_median_LOO|    / actual  (only when type has data)
  let typeApplicableCount = 0;
  const missesOverall: number[] = [];
  const missesType: number[] = [];
  const perTypeRows: { type: string; n: number; missOverall: number; missType: number }[] =
    [];

  for (const e of thinSet) {
    const actual = eventRevenue(e);
    if (actual <= 0) continue;

    // Overall median LOO
    const overallLOO = median(
      allRevenues.filter((_, idx) => eligible[idx].id !== e.id)
    );
    const missOverall = Math.abs(actual - overallLOO) / actual;
    missesOverall.push(missOverall);

    // Type median LOO
    const t = normalizeEventType(e.event_type);
    if (!t) continue;
    if (focusType && t !== focusType.toLowerCase()) continue;
    const sameType = byType.get(t) ?? [];
    const sameTypeLOO = sameType.filter(
      (other) => other.id !== e.id && other.event_date < e.event_date
    );
    // Need at least 3 prior same-type observations to compute a
    // meaningful type prior — same threshold the planning brief
    // recommends for type-cluster activation.
    if (sameTypeLOO.length < 3) continue;
    const typeMedian = median(sameTypeLOO.map(eventRevenue));
    const missType = Math.abs(actual - typeMedian) / actual;
    missesType.push(missType);
    typeApplicableCount++;

    perTypeRows.push({
      type: t,
      n: sameTypeLOO.length,
      missOverall,
      missType,
    });
  }

  console.log(
    `Of thin-same-name rows, type-prior was applicable for: ${typeApplicableCount}`
  );

  if (typeApplicableCount === 0) {
    console.log(
      "\nNo events had both thin same-name AND 3+ same-type history. " +
        "Operator's data is too sparse across event types for clustering to help yet."
    );
    return;
  }

  // Headline: median |miss| comparison.
  // Compute the type-median only on the rows where type prior fired
  // (apples-to-apples — only rows where the type-prior was usable).
  const matchedMissesOverall: number[] = [];
  for (const r of perTypeRows) matchedMissesOverall.push(r.missOverall);
  const medianOverallMatched = median(matchedMissesOverall);
  const medianType = median(missesType);

  console.log("\n--- Headline: median |miss| on thin-same-name events ---");
  console.log(
    `Operator-overall prior:  ${pct(medianOverallMatched)}  (n=${matchedMissesOverall.length})`
  );
  console.log(
    `Event-type prior:        ${pct(medianType)}  (n=${missesType.length})`
  );
  const deltaPct = medianOverallMatched - medianType;
  const better = deltaPct > 0 ? "BETTER" : "WORSE";
  console.log(
    `Type-cluster delta:      ${deltaPct >= 0 ? "-" : "+"}${pct(Math.abs(deltaPct))} ${better}`
  );

  // Per-type breakdown so the operator can see which event_types
  // benefit and which regress.
  console.log("\n--- Per-event-type breakdown ---");
  console.log(
    `${"event_type".padEnd(28)}${"n".padStart(6)}${"overall".padStart(10)}${"type".padStart(10)}${"delta".padStart(10)}`
  );

  const perTypeAgg = new Map<string, { n: number; mo: number[]; mt: number[] }>();
  for (const r of perTypeRows) {
    if (!perTypeAgg.has(r.type)) {
      perTypeAgg.set(r.type, { n: 0, mo: [], mt: [] });
    }
    const agg = perTypeAgg.get(r.type)!;
    agg.n += 1;
    agg.mo.push(r.missOverall);
    agg.mt.push(r.missType);
  }

  for (const [t, agg] of [...perTypeAgg.entries()].sort(
    (a, b) => b[1].n - a[1].n
  )) {
    const mo = median(agg.mo);
    const mt = median(agg.mt);
    const delta = mo - mt;
    const sign = delta >= 0 ? "-" : "+";
    console.log(
      `${t.padEnd(28)}${String(agg.n).padStart(6)}${pct(mo).padStart(10)}${pct(mt).padStart(10)}${`${sign}${pct(Math.abs(delta))}`.padStart(10)}`
    );
  }

  // Interpretation summary.
  console.log("\n--- Interpretation ---");
  if (deltaPct >= 0.05) {
    console.log(
      `Type-cluster prior produced ${pct(deltaPct)} lower median |miss| on thin-same-name events.`
    );
    console.log(
      "That's a meaningful improvement (>=5pp). Recommends shipping Workstream A."
    );
  } else if (deltaPct <= -0.05) {
    console.log(
      `Type-cluster prior produced ${pct(Math.abs(deltaPct))} HIGHER median |miss|.`
    );
    console.log(
      "Event_type signal is noisier than the operator's overall posterior."
    );
    console.log(
      "Recommends NOT shipping Workstream A — at least not with the simple-median formulation."
    );
  } else {
    console.log(
      `Delta is ${pct(Math.abs(deltaPct))} — within noise range. Not enough signal to recommend.`
    );
    console.log(
      "Consider running on Best Wurst + Buzzy Bites for additional perspectives."
    );
  }

  console.log("\n" + "=".repeat(78) + "\n");
}
