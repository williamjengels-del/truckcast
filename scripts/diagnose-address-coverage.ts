#!/usr/bin/env node
// Read-only: address/lat-lng coverage diagnostic on operator events.
// Reports how many events have city, state, latitude, longitude,
// location (free-text venue), and broken-out coverage by recency.
//
// Used as input to the address-required scoping doc — quantifies the
// backfill story for the proposed cross-op canonicalization workstream.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/diagnose-address-coverage.ts [user-id ...]
//   (no args = all sharing-enabled operators)

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

interface EventRow {
  id: string;
  event_date: string;
  event_name: string;
  city: string | null;
  state: string | null;
  location: string | null;
  city_area: string | null;
  latitude: number | null;
  longitude: number | null;
}

async function loadEvents(userId: string): Promise<EventRow[]> {
  const out: EventRow[] = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("events")
      .select(
        "id, event_date, event_name, city, state, location, city_area, latitude, longitude"
      )
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`events fetch failed for ${userId}:`, error.message);
      break;
    }
    const rows = (data ?? []) as EventRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function report(rows: EventRow[], label: string) {
  const total = rows.length;
  const hasCity = rows.filter((r) => r.city && r.city.trim()).length;
  const hasState = rows.filter((r) => r.state && r.state.trim()).length;
  const hasLocation = rows.filter((r) => r.location && r.location.trim()).length;
  const hasCityArea = rows.filter((r) => r.city_area && r.city_area.trim())
    .length;
  const hasLat = rows.filter((r) => r.latitude != null).length;
  const hasLng = rows.filter((r) => r.longitude != null).length;
  const hasLatLng = rows.filter((r) => r.latitude != null && r.longitude != null)
    .length;

  console.log("");
  console.log(`${label}  (${total} events)`);
  console.log(`  city:        ${hasCity.toString().padStart(4)}  ${pct(hasCity, total)}`);
  console.log(`  state:       ${hasState.toString().padStart(4)}  ${pct(hasState, total)}`);
  console.log(`  location:    ${hasLocation.toString().padStart(4)}  ${pct(hasLocation, total)}`);
  console.log(`  city_area:   ${hasCityArea.toString().padStart(4)}  ${pct(hasCityArea, total)}`);
  console.log(`  latitude:    ${hasLat.toString().padStart(4)}  ${pct(hasLat, total)}`);
  console.log(`  longitude:   ${hasLng.toString().padStart(4)}  ${pct(hasLng, total)}`);
  console.log(`  lat AND lng: ${hasLatLng.toString().padStart(4)}  ${pct(hasLatLng, total)}`);
}

async function main() {
  let userIds = process.argv.slice(2);
  if (userIds.length === 0) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, business_name")
      .eq("data_sharing_enabled", true);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    for (const p of (data ?? []) as { id: string; business_name: string | null }[]) {
      userIds.push(p.id);
    }
  }
  const labels = new Map<string, string>();
  const { data: pdata } = await supabase
    .from("profiles")
    .select("id, business_name")
    .in("id", userIds);
  for (const p of (pdata ?? []) as { id: string; business_name: string | null }[]) {
    labels.set(p.id, p.business_name ?? "(no business name)");
  }

  console.log("=".repeat(70));
  console.log(" Address / lat-lng coverage diagnostic");
  console.log("=".repeat(70));

  for (const uid of userIds) {
    const rows = await loadEvents(uid);
    if (rows.length === 0) {
      console.log(`\n${labels.get(uid) ?? uid}  — no events`);
      continue;
    }
    report(rows, `${labels.get(uid) ?? uid}  [${uid}]`);

    // Recency breakdown — last 6 months vs older
    const today = new Date().toISOString().slice(0, 10);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const cutoff = sixMonthsAgo.toISOString().slice(0, 10);
    const recent = rows.filter((r) => r.event_date >= cutoff && r.event_date <= today);
    const older = rows.filter((r) => r.event_date < cutoff);
    const future = rows.filter((r) => r.event_date > today);
    report(recent, `  └─ last 6 months (${cutoff} → ${today})`);
    report(older, `  └─ older than 6 months`);
    report(future, `  └─ future (event_date > today)`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
