#!/usr/bin/env node
// Re-geocode events whose stored lat/lng is far from the canonical
// city+state result. Catches events that geocoded BEFORE state was
// populated (now fixed in PR #221 + the state backfill) — those
// could have country-wide-population fallbacks that landed in
// the wrong state. Block Party 2026-05-07 was geocoded to Clayton,
// TX (32.57, -98.30) instead of Clayton, MO (38.65, -90.34) —
// example surfaced by operator 2026-05-07.
//
// Strategy:
//   1. For each event with city + state + lat/lng, geocode (city,
//      state) via the same path used by the form save.
//   2. If the new coords are > 50 miles from stored, propose update.
//   3. Dry-run by default. --apply writes updated lat/lng AND clears
//      the corresponding weather_cache row so the next recalc
//      re-fetches weather from the correct location.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/regeocode-stale-coords.ts <user-id>           # dry-run
//   npx tsx scripts/regeocode-stale-coords.ts <user-id> --apply   # writes

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { geocodeCity } from "../src/lib/weather.ts";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const apply = process.argv.includes("--apply");
const outputPath = "./regeocode-proposals.tsv";

if (!userId) {
  console.error("Usage: npx tsx scripts/regeocode-stale-coords.ts <user-id> [--apply]");
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 3959;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface Proposal {
  eventId: string;
  eventDate: string;
  eventName: string;
  city: string;
  state: string;
  oldLat: number;
  oldLng: number;
  newLat: number;
  newLng: number;
  driftMi: number;
}

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("id, event_date, event_name, city, state, latitude, longitude")
    .eq("user_id", userId)
    .not("city", "is", null)
    .not("state", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (error) throw error;
  const events = (data ?? []) as Pick<
    Event,
    "id" | "event_date" | "event_name" | "city" | "state" | "latitude" | "longitude"
  >[];

  console.log(`\nEvents with city + state + lat/lng to check: ${events.length}`);

  const proposals: Proposal[] = [];
  // Cache geocode results per (city, state) so we don't re-call for repeats.
  const geocodeCache = new Map<string, { latitude: number; longitude: number } | null>();
  let i = 0;
  for (const e of events) {
    i++;
    const city = (e.city ?? "").trim();
    const state = (e.state ?? "").trim();
    if (!city || !state) continue;
    const key = `${city.toLowerCase()}|${state.toUpperCase()}`;
    let coords = geocodeCache.get(key);
    if (coords === undefined) {
      coords = await geocodeCity(city, state);
      geocodeCache.set(key, coords);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!coords) continue;
    const drift = haversineMiles(
      { latitude: e.latitude!, longitude: e.longitude! },
      coords
    );
    if (drift > 50) {
      proposals.push({
        eventId: e.id,
        eventDate: e.event_date,
        eventName: e.event_name,
        city,
        state,
        oldLat: e.latitude!,
        oldLng: e.longitude!,
        newLat: coords.latitude,
        newLng: coords.longitude,
        driftMi: drift,
      });
    }
    if (i % 100 === 0) {
      console.log(`  ${i}/${events.length}  proposals=${proposals.length}`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`PROPOSED REGEOCODES — ${proposals.length} events with drift > 50mi`);
  console.log("=".repeat(70));

  // Group by (city, state) for the summary.
  const cityStateGroups = new Map<string, number>();
  for (const p of proposals) {
    const k = `${p.city}, ${p.state}`;
    cityStateGroups.set(k, (cityStateGroups.get(k) ?? 0) + 1);
  }
  console.log(`\nBy city/state:`);
  for (const [k, c] of [...cityStateGroups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(40)} ${c}`);
  }

  if (proposals.length > 0) {
    console.log(`\n--- Sample 15 ---`);
    for (const p of proposals.slice(0, 15)) {
      console.log(
        `  ${p.eventDate}  ${p.city}, ${p.state}  ` +
          `(${p.oldLat.toFixed(2)},${p.oldLng.toFixed(2)})→(${p.newLat.toFixed(2)},${p.newLng.toFixed(2)})  ` +
          `drift=${p.driftMi.toFixed(0)}mi  ${p.eventName.slice(0, 40)}`
      );
    }
  }

  // TSV.
  const headers = [
    "event_id", "event_date", "event_name", "city", "state",
    "old_lat", "old_lng", "new_lat", "new_lng", "drift_mi",
  ];
  const lines = [
    headers.join("\t"),
    ...proposals.map((p) =>
      [
        p.eventId, p.eventDate, p.eventName, p.city, p.state,
        p.oldLat, p.oldLng, p.newLat, p.newLng, p.driftMi.toFixed(1),
      ].map((v) => String(v).replace(/\t/g, " ")).join("\t")
    ),
  ];
  writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nFull TSV: ${outputPath}`);

  if (!apply) {
    console.log(`\nDRY RUN — no records modified. --apply to write.`);
    return;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`APPLYING ${proposals.length} REGEOCODES`);
  console.log("=".repeat(70));

  let updated = 0;
  let failed = 0;
  for (const p of proposals) {
    const { error: upErr } = await supabase
      .from("events")
      .update({ latitude: p.newLat, longitude: p.newLng })
      .eq("id", p.eventId)
      .eq("user_id", userId);
    if (upErr) {
      console.error(`  FAILED ${p.eventId}: ${upErr.message}`);
      failed++;
      continue;
    }
    updated++;
    // Clear weather_cache row at the OLD coords for this date so the
    // next recalc fetches weather from the corrected location. The
    // cache is keyed by (date, lat±0.1, lng±0.1) so the old row
    // won't be hit by the new lat/lng — just stale data, not
    // actively wrong, but leaving it leaves storage bloat.
    await supabase
      .from("weather_cache")
      .delete()
      .eq("date", p.eventDate)
      .gte("latitude", p.oldLat - 0.1)
      .lte("latitude", p.oldLat + 0.1)
      .gte("longitude", p.oldLng - 0.1)
      .lte("longitude", p.oldLng + 0.1);
  }
  console.log(`\nUpdated: ${updated}  Failed: ${failed}`);
  console.log("\nNext: re-run scripts/backfill-weather-cache.ts to populate");
  console.log("weather at the new coordinates, then trigger-recalc.ts to");
  console.log("refresh v2 shadow values.");
}
