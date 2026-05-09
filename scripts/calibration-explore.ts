#!/usr/bin/env node
// Diagnostic: what scalar multiplier on stored interval half-widths
// would bring observed 80% / 50% coverage to target (80% / 50%)?
//
// Reads forecast_bayesian_point, forecast_bayesian_low_80/high_80,
// and forecast_bayesian_low_50/high_50 + actuals from past events.
// Treats stored intervals as point ± z*sigma with z=1.282 for 80% and
// z=0.674 for 50% (standard Normal). Computes:
//   1. Empirical k_80 = (80th pct of |z_i|) / 1.282
//   2. Empirical k_50 = (50th pct of |z_i|) / 0.674
//   3. Coverage simulation under each k
//
// Read-only. Service-role client. Safe to run anytime.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/calibration-explore.ts <user-id>

import { createClient } from "@supabase/supabase-js";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/calibration-explore.ts <user-id>");
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

const Z80 = 1.281552; // standard normal 80% interval z (one-sided 90th pct)
const Z50 = 0.674490; // standard normal 50% interval z (one-sided 75th pct)

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  const all = (data ?? []) as Event[];
  const eligible = all.filter(
    (e) =>
      e.booked &&
      e.event_date < today &&
      (e.net_sales ?? 0) > 0 &&
      e.anomaly_flag !== "disrupted" &&
      e.anomaly_flag !== "boosted" &&
      e.forecast_bayesian_point != null &&
      e.forecast_bayesian_low_80 != null &&
      e.forecast_bayesian_high_80 != null &&
      e.forecast_bayesian_low_50 != null &&
      e.forecast_bayesian_high_50 != null
  );
  console.log(`\nEligible pairs: ${eligible.length}`);

  // Per-event z-score using sigma backed out of the 80% interval
  // (point - sigma*Z80 to point + sigma*Z80).
  const records = eligible.map((e) => {
    const point = e.forecast_bayesian_point!;
    const halfWidth80 = (e.forecast_bayesian_high_80! - e.forecast_bayesian_low_80!) / 2;
    const halfWidth50 = (e.forecast_bayesian_high_50! - e.forecast_bayesian_low_50!) / 2;
    const sigma = halfWidth80 / Z80; // back out sigma from 80% interval
    const sigma50 = halfWidth50 / Z50; // sanity check — should match
    const residual = e.net_sales! - point;
    const zAbs = sigma > 0 ? Math.abs(residual / sigma) : Infinity;
    return {
      eventName: e.event_name,
      point,
      actual: e.net_sales!,
      sigma,
      sigma50,
      halfWidth80,
      halfWidth50,
      residual,
      zAbs,
      lo80: e.forecast_bayesian_low_80!,
      hi80: e.forecast_bayesian_high_80!,
      lo50: e.forecast_bayesian_low_50!,
      hi50: e.forecast_bayesian_high_50!,
    };
  });

  // Sanity check: do half-widths imply same sigma for 80% and 50%?
  // If yes → engine emits Normal posterior. If no → asymmetric / non-Normal.
  const ratios = records.map((r) => r.sigma50 / r.sigma).filter((x) => Number.isFinite(x) && x > 0);
  ratios.sort((a, b) => a - b);
  console.log(`\nSanity: ratio of (sigma derived from 50%) / (sigma derived from 80%):`);
  console.log(`  median: ${pct(ratios)} | p10: ${ratios[Math.floor(ratios.length * 0.1)].toFixed(3)} | p90: ${ratios[Math.floor(ratios.length * 0.9)].toFixed(3)}`);
  console.log(`  Should be ≈1.0 if engine emits Normal. Deviation = engine emits non-Normal posterior.`);

  // Empirical |z| distribution
  const zs = records.map((r) => r.zAbs).filter((z) => Number.isFinite(z));
  zs.sort((a, b) => a - b);
  console.log(`\nEmpirical |z| distribution (n=${zs.length}):`);
  console.log(`  p25: ${zs[Math.floor(zs.length * 0.25)].toFixed(3)}  (Normal ref: 0.319)`);
  console.log(`  p50: ${zs[Math.floor(zs.length * 0.5)].toFixed(3)}  (Normal ref: 0.674) ← drives 50% interval`);
  console.log(`  p75: ${zs[Math.floor(zs.length * 0.75)].toFixed(3)}  (Normal ref: 1.150)`);
  console.log(`  p80: ${zs[Math.floor(zs.length * 0.8)].toFixed(3)}  (Normal ref: 1.282) ← drives 80% interval`);
  console.log(`  p90: ${zs[Math.floor(zs.length * 0.9)].toFixed(3)}  (Normal ref: 1.645)`);
  console.log(`  p95: ${zs[Math.floor(zs.length * 0.95)].toFixed(3)}  (Normal ref: 1.960)`);

  // Required scaling factors
  const z80emp = zs[Math.floor(zs.length * 0.8)];
  const z50emp = zs[Math.floor(zs.length * 0.5)];
  const k80 = z80emp / Z80;
  const k50 = z50emp / Z50;
  console.log(`\nRequired multipliers to hit target coverage:`);
  console.log(`  k_80 = ${k80.toFixed(3)}  (multiply 80% half-width by this to hit 80% coverage)`);
  console.log(`  k_50 = ${k50.toFixed(3)}  (multiply 50% half-width by this to hit 50% coverage)`);
  console.log(`  Single-k compromise (use larger): ${Math.max(k80, k50).toFixed(3)}`);

  // Asymmetric interval analysis — engine emits skewed posterior.
  // Compute lower-distance (point - lo) and upper-distance (hi - point)
  // separately; scaling preserves shape.
  console.log(`\nResidual sign distribution (is the engine biased?):`);
  const positiveResid = records.filter((r) => r.residual > 0).length;
  const negativeResid = records.filter((r) => r.residual < 0).length;
  console.log(`  actual > forecast: ${positiveResid} (${((positiveResid / records.length) * 100).toFixed(1)}%) — engine UNDER-forecast`);
  console.log(`  actual < forecast: ${negativeResid} (${((negativeResid / records.length) * 100).toFixed(1)}%) — engine OVER-forecast`);
  console.log(`  If split is far from 50/50, engine has directional bias.`);

  // Asymmetric scaling: multiply lower-distance and upper-distance independently.
  // For a stored interval [lo, hi] around point, scaled = [point - k_lo*(point-lo), point + k_hi*(hi-point)]
  // Coverage check: lo_scaled <= actual <= hi_scaled.
  console.log(`\nAsymmetric scaling — coverage simulation (lo,hi multipliers):`);
  console.log(`  ${"k_lo".padEnd(8)}${"k_hi".padEnd(8)}${"cov80%".padEnd(10)}${"cov50%".padEnd(10)}note`);
  const asymCandidates: Array<{ kLo: number; kHi: number; note: string }> = [
    { kLo: 1.0, kHi: 1.0, note: "current (no scaling)" },
    { kLo: 1.0, kHi: 1.3, note: "widen upper only" },
    { kLo: 1.0, kHi: 1.5, note: "widen upper more" },
    { kLo: 1.0, kHi: 2.0, note: "widen upper a lot" },
    { kLo: 1.2, kHi: 1.2, note: "symmetric +20%" },
    { kLo: 1.3, kHi: 1.3, note: "symmetric +30%" },
    { kLo: 0.9, kHi: 1.5, note: "shift up" },
    { kLo: 0.8, kHi: 1.7, note: "shift up more" },
  ];
  for (const { kLo, kHi, note } of asymCandidates) {
    const c80 = records.filter((r) => {
      const lo = r.point - kLo * (r.point - r.lo80);
      const hi = r.point + kHi * (r.hi80 - r.point);
      return r.actual >= lo && r.actual <= hi;
    }).length;
    const c50 = records.filter((r) => {
      const lo = r.point - kLo * (r.point - r.lo50);
      const hi = r.point + kHi * (r.hi50 - r.point);
      return r.actual >= lo && r.actual <= hi;
    }).length;
    console.log(
      `  ${kLo.toFixed(2).padEnd(8)}${kHi.toFixed(2).padEnd(8)}${((c80 / records.length) * 100).toFixed(1).padEnd(10)}${((c50 / records.length) * 100).toFixed(1).padEnd(10)}${note}`
    );
  }

  // Find empirically optimal asymmetric (k_lo, k_hi) for 80% coverage
  // via grid search.
  console.log(`\nGrid search — best (k_lo, k_hi) to hit 80% coverage on 80% interval:`);
  let bestPair = { kLo: 1.0, kHi: 1.0, c80: 0 };
  let bestPair50 = { kLo: 1.0, kHi: 1.0, c50: 0 };
  for (let kLo = 0.5; kLo <= 2.5; kLo += 0.05) {
    for (let kHi = 0.5; kHi <= 2.5; kHi += 0.05) {
      const c80 = records.filter((r) => {
        const lo = r.point - kLo * (r.point - r.lo80);
        const hi = r.point + kHi * (r.hi80 - r.point);
        return r.actual >= lo && r.actual <= hi;
      }).length;
      const c50 = records.filter((r) => {
        const lo = r.point - kLo * (r.point - r.lo50);
        const hi = r.point + kHi * (r.hi50 - r.point);
        return r.actual >= lo && r.actual <= hi;
      }).length;
      // Track only points that hit the target band, prefer narrowest.
      const cov80 = c80 / records.length;
      const cov50 = c50 / records.length;
      if (cov80 >= 0.78 && cov80 <= 0.82) {
        const width = kLo + kHi;
        const bestWidth = bestPair.kLo + bestPair.kHi;
        if (bestPair.c80 === 0 || width < bestWidth) {
          bestPair = { kLo, kHi, c80 };
        }
      }
      if (cov50 >= 0.48 && cov50 <= 0.52) {
        const width = kLo + kHi;
        const bestWidth = bestPair50.kLo + bestPair50.kHi;
        if (bestPair50.c50 === 0 || width < bestWidth) {
          bestPair50 = { kLo, kHi, c50 };
        }
      }
    }
  }
  console.log(`  80%: best narrowest pair = (k_lo=${bestPair.kLo.toFixed(2)}, k_hi=${bestPair.kHi.toFixed(2)}) → coverage ${((bestPair.c80 / records.length) * 100).toFixed(1)}%`);
  console.log(`  50%: best narrowest pair = (k_lo=${bestPair50.kLo.toFixed(2)}, k_hi=${bestPair50.kHi.toFixed(2)}) → coverage ${((bestPair50.c50 / records.length) * 100).toFixed(1)}%`);

  // Per-event-name k diagnostic — does any single event's residual
  // distribution dominate?
  console.log(`\nLargest |z| outliers (top 10):`);
  const sorted = [...records].sort((a, b) => b.zAbs - a.zAbs).slice(0, 10);
  for (const r of sorted) {
    console.log(
      `  ${r.eventName.slice(0, 30).padEnd(32)} z=${r.zAbs.toFixed(2)}  point=${r.point.toFixed(0)}  actual=${r.actual.toFixed(0)}  sigma=${r.sigma.toFixed(0)}`
    );
  }
}

function pct(arr: number[]): string {
  if (arr.length === 0) return "n/a";
  return arr[Math.floor(arr.length / 2)].toFixed(3);
}
