#!/usr/bin/env node
// Read-only: check the prior_src distribution on FUTURE events for a
// given user, plus which event_names are matching the platform_events
// table and which aren't.
//
// The calibration report only measures PAST events (needs actuals).
// Past-event backfill in recalculate.ts intentionally doesn't pass
// platformEvent — so the calibration report shows 100% operator
// regardless of platform_events state. Future events DO get the
// platform prior. This script reveals what the calibration report
// can't see.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/diagnose-future-event-priors.ts [user-id]

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const userId = process.argv[2] ?? "7f97040f-023d-4604-8b66-f5aa321c31de";
const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log(`User: ${userId}`);
  console.log(`Today: ${today}`);
  console.log("");

  const { data, error } = await supabase
    .from("events")
    .select(
      "id, event_name, event_date, booked, forecast_bayesian_point, forecast_bayesian_low_80, forecast_bayesian_high_80, forecast_bayesian_prior_src, forecast_bayesian_n_obs, forecast_bayesian_computed_at, anomaly_flag"
    )
    .eq("user_id", userId)
    .gte("event_date", today)
    .order("event_date", { ascending: true });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    event_name: string;
    event_date: string;
    booked: boolean;
    forecast_bayesian_point: number | null;
    forecast_bayesian_low_80: number | null;
    forecast_bayesian_high_80: number | null;
    forecast_bayesian_prior_src: string | null;
    forecast_bayesian_n_obs: number | null;
    forecast_bayesian_computed_at: string | null;
    anomaly_flag: string | null;
  }>;

  console.log(`Total future events: ${rows.length}`);

  // Prior-src distribution
  const dist: Record<string, number> = {};
  for (const r of rows) {
    const k = r.forecast_bayesian_prior_src ?? "null";
    dist[k] = (dist[k] ?? 0) + 1;
  }
  console.log("");
  console.log("Stored prior_src distribution (future events):");
  for (const [k, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${n.toString().padStart(4)}  (${((n / rows.length) * 100).toFixed(1)}%)`);
  }

  // Most recent computed_at
  const computedAts = rows
    .map((r) => r.forecast_bayesian_computed_at)
    .filter((s): s is string => !!s)
    .sort();
  if (computedAts.length > 0) {
    console.log("");
    console.log(`Earliest v2 write (future): ${computedAts[0]}`);
    console.log(`Latest v2 write (future):   ${computedAts[computedAts.length - 1]}`);
  }

  // Platform-fired events
  const platformFired = rows.filter(
    (r) => r.forecast_bayesian_prior_src === "platform"
  );
  if (platformFired.length > 0) {
    console.log("");
    console.log("=".repeat(70));
    console.log(" Future events where platform-prior FIRED");
    console.log("=".repeat(70));
    for (const r of platformFired.slice(0, 25)) {
      const point = r.forecast_bayesian_point;
      const low = r.forecast_bayesian_low_80;
      const high = r.forecast_bayesian_high_80;
      const range =
        point && low && high
          ? `$${Math.round(point)}  ($${Math.round(low)}–$${Math.round(high)})`
          : "—";
      console.log(
        `  • ${r.event_date}  ${r.event_name.padEnd(40)}  ${range}  n_obs=${r.forecast_bayesian_n_obs ?? "—"}`
      );
    }
    if (platformFired.length > 25)
      console.log(`  ... and ${platformFired.length - 25} more.`);
  }

  // Names that SHOULD be platform-firing per the exact-overlap list but aren't
  const expectedPlatform = new Set([
    "9 mile garden",
    "adventure summit",
    "bark in the park",
    "blues at the arch",
    "dogtown st. patrick's day parade",
    "downtown summer nights",
    "lunchtime live",
    "punk rock flea market",
    "rockwell brewing company",
    "scott air force base",
    "shamrock and roll",
    "shutterfest",
    "st. charles riverfest",
  ]);
  const expectedMisses = rows.filter(
    (r) =>
      expectedPlatform.has(r.event_name.toLowerCase().trim()) &&
      r.forecast_bayesian_prior_src !== "platform"
  );
  if (expectedMisses.length > 0) {
    console.log("");
    console.log("=".repeat(70));
    console.log(" Future events at shared venues NOT using platform-prior (unexpected)");
    console.log("=".repeat(70));
    for (const r of expectedMisses.slice(0, 25)) {
      console.log(
        `  • ${r.event_date}  ${r.event_name.padEnd(40)}  prior=${r.forecast_bayesian_prior_src ?? "null"}  booked=${r.booked}  computed_at=${(r.forecast_bayesian_computed_at ?? "—").slice(0, 19)}`
      );
    }
    if (expectedMisses.length > 25)
      console.log(`  ... and ${expectedMisses.length - 25} more.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
