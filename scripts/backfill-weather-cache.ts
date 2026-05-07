#!/usr/bin/env node
// Backfill weather_cache rows for past events that have city + state
// populated. Once the cache is filled, v2's continuous-weather path
// kicks in retroactively for those events on the next recalc — turns
// the categorical "Hot" / "Storms" coefficient into the actual
// max_temp_f / precipitation_in continuous coefficient.
//
// Strategy:
//   - Iterate past booked events with city populated and event_date
//     in the operator's actual data range (geocoder + Open-Meteo
//     archive both handle old dates fine).
//   - For each event, call autoClassifyWeather(city, date, supabase,
//     state). The function geocodes, calls the archive API, writes
//     to weather_cache as a side effect, and returns the daily
//     classification. We discard the classification — what we want
//     is the cache row.
//   - Skip events already cached (any existing weather_cache row in
//     the geographic/date neighborhood is reuse-eligible).
//   - Polite 100ms delay between calls. Free tier is 10k/day, we
//     have ~689 events to process — well within bounds.
//
// Read-only on event records (no event mutations). Writes to
// weather_cache via the existing helper. Idempotent — safe to re-run.
//
// Per the no-auto-fix rule (memory: feedback_no_auto_fix_data), this
// script writes to a CACHE table, not operator-owned event data. The
// cache is fully reproducible from the geocoder + Open-Meteo, so a
// bad write just gets re-fetched. Lower risk than event mutation.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/backfill-weather-cache.ts <user-id>            # dry-run summary
//   npx tsx scripts/backfill-weather-cache.ts <user-id> --apply    # actually fetches

import { createClient } from "@supabase/supabase-js";
import { autoClassifyWeather } from "../src/lib/weather.ts";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!userId) {
  console.error("Usage: npx tsx scripts/backfill-weather-cache.ts <user-id> [--apply]");
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
    .select("id, event_date, event_name, city, state, latitude, longitude")
    .eq("user_id", userId)
    .eq("booked", true)
    .lt("event_date", today);
  if (error) throw error;
  const allPast = (data ?? []) as Pick<
    Event,
    "id" | "event_date" | "event_name" | "city" | "state" | "latitude" | "longitude"
  >[];

  const withCity = allPast.filter((e) => (e.city ?? "").trim() !== "");
  console.log(`\nPast booked events: ${allPast.length}`);
  console.log(`  with city populated: ${withCity.length}`);

  // Probe: how many of these are already in weather_cache? Approximate
  // by looking up (date, lat/lng) for events that have lat/lng. Events
  // without lat/lng need geocoding first; can't probe efficiently.
  let cached = 0;
  let needsBackfill = 0;
  for (const e of withCity) {
    if (e.latitude == null || e.longitude == null) {
      needsBackfill++;
      continue;
    }
    const { data: row } = await supabase
      .from("weather_cache")
      .select("id, max_temp_f, precipitation_in")
      .eq("date", e.event_date)
      .gte("latitude", e.latitude - 0.1)
      .lte("latitude", e.latitude + 0.1)
      .gte("longitude", e.longitude - 0.1)
      .lte("longitude", e.longitude + 0.1)
      .maybeSingle();
    if (row && (row.max_temp_f != null || row.precipitation_in != null)) {
      cached++;
    } else {
      needsBackfill++;
    }
  }

  console.log(`  already cached: ${cached}`);
  console.log(`  need backfill:  ${needsBackfill}`);

  if (!apply) {
    console.log(`\nDRY RUN. Re-run with --apply to fetch and cache weather`);
    console.log(`for the ${needsBackfill} events that need it. Open-Meteo`);
    console.log(`free tier handles ~10k calls/day — well within bounds.`);
    return;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`BACKFILLING ${needsBackfill} weather_cache rows`);
  console.log(`${"=".repeat(70)}\n`);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let i = 0;
  for (const e of withCity) {
    i++;
    // Re-check the cache (a recent backfill of an earlier event may
    // have populated this row already if events share date+location).
    if (e.latitude != null && e.longitude != null) {
      const { data: row } = await supabase
        .from("weather_cache")
        .select("id, max_temp_f, precipitation_in")
        .eq("date", e.event_date)
        .gte("latitude", e.latitude - 0.1)
        .lte("latitude", e.latitude + 0.1)
        .gte("longitude", e.longitude - 0.1)
        .lte("longitude", e.longitude + 0.1)
        .maybeSingle();
      if (row && (row.max_temp_f != null || row.precipitation_in != null)) {
        skipped++;
        continue;
      }
    }
    try {
      const wx = await autoClassifyWeather(
        e.city!,
        e.event_date,
        supabase,
        e.state ?? null
      );
      if (wx) {
        succeeded++;
        // Also populate the event's lat/lng if currently missing —
        // saves a re-geocode on subsequent recalc.
        if (e.latitude == null || e.longitude == null) {
          await supabase
            .from("events")
            .update({ latitude: wx.latitude, longitude: wx.longitude })
            .eq("id", e.id);
        }
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED ${e.event_date} ${e.city}: ${(err as Error).message}`);
    }
    if (i % 50 === 0) {
      console.log(`  ${i}/${withCity.length}  succeeded=${succeeded}  failed=${failed}  skipped=${skipped}`);
    }
    // Polite delay to Open-Meteo.
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`DONE  succeeded=${succeeded}  failed=${failed}  skipped=${skipped}`);
  console.log(`${"=".repeat(70)}`);
  console.log("\nNext step: hit Refresh Forecasts on the dashboard so the");
  console.log("v2 engine reads the new cache rows and writes updated shadow");
  console.log("values. Then run scripts/bayesian-calibration-report.ts to");
  console.log("see the lift.");
}
