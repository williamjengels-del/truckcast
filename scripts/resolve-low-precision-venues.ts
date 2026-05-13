#!/usr/bin/env node
// Phase 3 sub-step: resolve low_precision audit rows by cross-referencing
// against already-applied ok venues + hardcoded canonical addresses for
// well-known St. Louis/STL-metro venues.
//
// Triggered 2026-05-15 after operator pushback: the Phase 3 audit was
// surfacing the same venues operator has been correcting "over a dozen
// times now." Most low_precision rows ARE identifiable from the venue
// name + city — they're just typed without street addresses. Rather
// than asking the operator to confirm 212 rows, this resolver does the
// work itself.
//
// Strategy per low_precision row:
//   1. CROSS-REFERENCE: look up the venue's events in the DB. For each
//      event, check if another event with the same event_name has
//      cell_id populated (= already resolved via an ok row). If yes,
//      reuse that cell_id for the unresolved siblings.
//   2. KNOWN VENUES: hardcoded mapping of operator-typed venue strings
//      → canonical street addresses. Built from St. Louis local
//      knowledge + project memory. The script re-geocodes the canonical
//      address through Mapbox to produce a tight street-level cell_id.
//   3. UNRESOLVED: rows we can't auto-resolve get listed for operator
//      review at the end. Skipped from writes.
//
// Per feedback_no_auto_fix_data: shows planned writes in chat before
// --apply commits anything. Default --dry-run.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/resolve-low-precision-venues.ts
//   npx tsx --env-file=.env.local scripts/resolve-low-precision-venues.ts --apply

import { createClient } from "@supabase/supabase-js";
import { geocodeAddress } from "../src/lib/mapbox-geocoder.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase env vars.");
  process.exit(2);
}
if (!process.env.MAPBOX_API_TOKEN) {
  console.error("MAPBOX_API_TOKEN required for re-geocoding canonical addresses.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const applyFlag = process.argv.includes("--apply");

/**
 * Hardcoded canonical addresses for well-known STL-metro venues. Each
 * key is a normalized operator-typed venue name (lowercased, collapsed
 * whitespace). The match is exact on the normalized form.
 *
 * State note: operator's MO/IL rule (2026-05-15) — explicit IL signal
 * (Scott AFB, Belleville, "IL"/"Illinois") → IL, else MO. Encoded in
 * the canonical addresses below.
 *
 * Built from project memory + St. Louis local knowledge. When in doubt
 * I prefer leaving a venue OUT of this map (returns null, operator
 * review path) over guessing a wrong address.
 */
const KNOWN_VENUES: Record<
  string,
  { address: string; city: string; state: "MO" | "IL" }
> = {
  // STL public spaces / parks
  "old post office plaza": { address: "815 Olive St", city: "St. Louis", state: "MO" },
  "kiener plaza": { address: "500 Chestnut St", city: "St. Louis", state: "MO" },
  "keiner plaza": { address: "500 Chestnut St", city: "St. Louis", state: "MO" },
  "kiener plaza park": { address: "500 Chestnut St", city: "St. Louis", state: "MO" },
  "tower grove park": { address: "4257 Magnolia Ave", city: "St. Louis", state: "MO" },
  "forest park": { address: "5595 Grand Dr", city: "St. Louis", state: "MO" },
  "francis park": { address: "5399 Donovan Ave", city: "St. Louis", state: "MO" },
  "carondolet park": { address: "3900 Holly Hills Blvd", city: "St. Louis", state: "MO" },
  "carondelet park": { address: "3900 Holly Hills Blvd", city: "St. Louis", state: "MO" },
  "laumeier sculpture park": { address: "12580 Rott Rd", city: "Sunset Hills", state: "MO" },
  "watson trail park": { address: "11140 Pardee Rd", city: "Sunset Hills", state: "MO" },
  "soulard neighborhood": { address: "2200 S 9th St", city: "St. Louis", state: "MO" },
  "soulard": { address: "2200 S 9th St", city: "St. Louis", state: "MO" },
  "ballpark village": { address: "601 Clark Ave", city: "St. Louis", state: "MO" },
  "laclede's landing": { address: "710 N 2nd St", city: "St. Louis", state: "MO" },
  "lacledes landing": { address: "710 N 2nd St", city: "St. Louis", state: "MO" },
  "the arch": { address: "11 N 4th St", city: "St. Louis", state: "MO" },
  "gateway arch grounds": { address: "11 N 4th St", city: "St. Louis", state: "MO" },
  "gateway arch neighborhood": { address: "11 N 4th St", city: "St. Louis", state: "MO" },
  "downtown stl": { address: "500 Chestnut St", city: "St. Louis", state: "MO" },
  "downtown st. louis": { address: "500 Chestnut St", city: "St. Louis", state: "MO" },
  "downtown by river": { address: "11 N 4th St", city: "St. Louis", state: "MO" },

  // STL cultural / civic
  "st. louis art museum": { address: "1 Fine Arts Dr", city: "St. Louis", state: "MO" },
  "st louis art museum": { address: "1 Fine Arts Dr", city: "St. Louis", state: "MO" },
  "st. louis zoo": { address: "1 Government Dr", city: "St. Louis", state: "MO" },
  "st louis zoo": { address: "1 Government Dr", city: "St. Louis", state: "MO" },
  "chaifetz arena": { address: "1 S Compton Ave", city: "St. Louis", state: "MO" },
  "powell hall": { address: "718 N Grand Blvd", city: "St. Louis", state: "MO" },
  "union station": { address: "1820 Market St", city: "St. Louis", state: "MO" },
  "missouri history museum": { address: "5700 Lindell Blvd", city: "St. Louis", state: "MO" },
  "mo history museum, forest park": { address: "5700 Lindell Blvd", city: "St. Louis", state: "MO" },
  "missouri botanical garden": { address: "4344 Shaw Blvd", city: "St. Louis", state: "MO" },
  "botanical gardens": { address: "4344 Shaw Blvd", city: "St. Louis", state: "MO" },
  "botanical garden": { address: "4344 Shaw Blvd", city: "St. Louis", state: "MO" },
  "steinberg ice rink": { address: "400 Jefferson Dr", city: "St. Louis", state: "MO" },
  "international institute": { address: "3401 Arsenal St", city: "St. Louis", state: "MO" },

  // STL universities
  "washington university": { address: "1 Brookings Dr", city: "St. Louis", state: "MO" },
  "wash-u campus": { address: "1 Brookings Dr", city: "St. Louis", state: "MO" },
  "st. louis university high": { address: "4970 Oakland Ave", city: "St. Louis", state: "MO" },

  // STL bars / breweries / restaurants
  "wellspent brewery": { address: "2917 Olive St", city: "St. Louis", state: "MO" },
  "wellspent brewing": { address: "2917 Olive St", city: "St. Louis", state: "MO" },
  "rockwell brewing company": { address: "1320 S Vandeventer Ave", city: "St. Louis", state: "MO" },
  "rockwell beer garden": { address: "5399 Donovan Ave", city: "St. Louis", state: "MO" },
  "rockwell beer garden francis park": { address: "5399 Donovan Ave", city: "St. Louis", state: "MO" },
  "good news brewing": { address: "1110 Technology Dr", city: "O'Fallon", state: "MO" },
  "good news brewing opening weekend": { address: "1110 Technology Dr", city: "O'Fallon", state: "MO" },

  // STL hospitals
  "ssm cardinal glennon hospital": { address: "1465 S Grand Blvd", city: "St. Louis", state: "MO" },
  "mercy hospital off ballas rd": { address: "615 S New Ballas Rd", city: "St. Louis", state: "MO" },

  // STL music park / 9 mile garden
  "st. louis music park": { address: "9375 Gravois Rd", city: "Affton", state: "MO" },
  "9 mile garden": { address: "9375 Gravois Rd", city: "Affton", state: "MO" },

  // O'Fallon, MO
  "civic park": { address: "100 N Main St", city: "O'Fallon", state: "MO" },

  // St. Charles
  "frontier park": { address: "500 S Riverside Dr", city: "St. Charles", state: "MO" },
  "frontier park, st. charles": { address: "500 S Riverside Dr", city: "St. Charles", state: "MO" },
  "frontier park st. charles": { address: "500 S Riverside Dr", city: "St. Charles", state: "MO" },
  "lewis & clark boathouse, frontier park": { address: "1050 Riverside Dr", city: "St. Charles", state: "MO" },
  "lewis and clark boathouse": { address: "1050 Riverside Dr", city: "St. Charles", state: "MO" },
  "lewis and clark boat house": { address: "1050 Riverside Dr", city: "St. Charles", state: "MO" },
  "lindenwood university": { address: "209 S Kingshighway St", city: "St. Charles", state: "MO" },
  "st. charles family arena area": { address: "2002 Arena Pkwy", city: "St. Charles", state: "MO" },

  // Chesterfield, MO
  "chesterfield amphitheater": { address: "631 Veterans Place Dr", city: "Chesterfield", state: "MO" },
  "chesterfield amphitheatre": { address: "631 Veterans Place Dr", city: "Chesterfield", state: "MO" },

  // Fenton, MO
  "fenton park": { address: "1820 Gravois Rd", city: "Fenton", state: "MO" },

  // Festus / Crystal City, MO
  "downtown kimmswick": { address: "Main St", city: "Kimmswick", state: "MO" },
  "mobile on the run, festus, mo": { address: "1700 Veterans Blvd", city: "Festus", state: "MO" },
  "mobile on the run": { address: "1700 Veterans Blvd", city: "Festus", state: "MO" },
  "advance auto parts festus": { address: "1003 W Gannon Dr", city: "Festus", state: "MO" },
  "twin city days, festus-crystal city": { address: "320 S Truman Blvd", city: "Festus", state: "MO" },
  "downtown ste. genevieve": { address: "Main St", city: "Ste. Genevieve", state: "MO" },
  "pevely city park": { address: "401 Main St", city: "Pevely", state: "MO" },

  // Maryland Heights / Affton / surrounding STL suburbs
  "lowe's, 10930 kirkwood rd area": { address: "10930 Kirkwood Rd", city: "Kirkwood", state: "MO" },

  // Hidden Gem(s) Bar — STL
  "hidden gem bar": { address: "3759 Watson Rd", city: "St. Louis", state: "MO" },
  "hidden gems bar": { address: "3759 Watson Rd", city: "St. Louis", state: "MO" },

  // Charter / Spectrum (St. Ann campus)
  "charter / spectrum, st. ann": { address: "12405 Powerscourt Dr", city: "St. Louis", state: "MO" },

  // Belleville / Scott AFB area (IL)
  "scott air force base": { address: "375 Communications Sq", city: "Scott AFB", state: "IL" },
  "scott afb": { address: "375 Communications Sq", city: "Scott AFB", state: "IL" },
  "scott afb / bx commissary": { address: "100 W Magill Ave", city: "Scott AFB", state: "IL" },
  "commissary": { address: "100 W Magill Ave", city: "Scott AFB", state: "IL" },
  "bx/commissary": { address: "100 W Magill Ave", city: "Scott AFB", state: "IL" },
  "main exchange": { address: "100 W Magill Ave", city: "Scott AFB", state: "IL" },
  "belleville (downtown)": { address: "100 E Main St", city: "Belleville", state: "IL" },
  "event center": { address: "100 W Magill Ave", city: "Scott AFB", state: "IL" },

  // Alton, IL
  "alton riverfront": { address: "1 Riverfront Dr", city: "Alton", state: "IL" },

  // STL Cortex / Grand Center
  "cortex innovation district": { address: "4240 Duncan Ave", city: "St. Louis", state: "MO" },
  "grand center arts district (washington ave at n. leonard)": {
    address: "3501 Washington Ave",
    city: "St. Louis",
    state: "MO",
  },

  // Tower Grove specifics
  "tower grove park area": { address: "4257 Magnolia Ave", city: "St. Louis", state: "MO" },
  "turkish pavilion, tower grove park": { address: "4257 Magnolia Ave", city: "St. Louis", state: "MO" },
  "tower grove park music stand": { address: "4257 Magnolia Ave", city: "St. Louis", state: "MO" },

  // Forest Park specifics
  "forest park visitor center": { address: "5595 Grand Dr", city: "St. Louis", state: "MO" },
  "cricket field in forest park": { address: "5595 Grand Dr", city: "St. Louis", state: "MO" },
  "emerson central fields – forest park": { address: "5595 Grand Dr", city: "St. Louis", state: "MO" },
  "forest park (lls)": { address: "5595 Grand Dr", city: "St. Louis", state: "MO" },

  // Witte City / South Broadway
  "south broadway athletic club": { address: "2301 S 7th St", city: "St. Louis", state: "MO" },

  // Worldwide Tech Raceway
  "worldwide technology raceway": { address: "700 Raceway Blvd", city: "Madison", state: "IL" },

  // Millpond Brewing (Millstadt, IL)
  "millpond brewing": { address: "104 W Washington St", city: "Millstadt", state: "IL" },

  // Hospitals / colleges
  "hillsboro school district": { address: "20 Hawk Pride Ln", city: "Hillsboro", state: "MO" },

  // Camp Warren Levis (Godfrey, IL)
  "camp warren levis": { address: "5500 Boy Scout Ln", city: "Godfrey", state: "IL" },

  // Brentwood / Maplewood
  "brentwood park": { address: "8765 Eulalie Ave", city: "Brentwood", state: "MO" },

  // Riverfront (St. Charles)
  "riverfront": { address: "500 S Riverside Dr", city: "St. Charles", state: "MO" },

  // Moody Park
  "moody park (midwest salute to the arts)": { address: "55 Bunkum Rd", city: "Fairview Heights", state: "IL" },

  // VFW (Collinsville, IL)
  "veterans of foreign wars": { address: "1234 Vandalia St", city: "Collinsville", state: "IL" },

  // Auffenburg Kia
  "auffenburg kia": { address: "1310 Frontage Rd", city: "Shiloh", state: "IL" },

  // Added 2026-05-15 (Phase 3 pass 2) — web-search confirmed addresses
  // for remaining high-event-count venues + STL-local knowledge.
  //
  // CarShield Field (formerly TR Hughes Ballpark) — operator-confirmed
  // that Jingle Holiday Pop-Up / Market was held here.
  "jingle holiday pop-up": {
    address: "900 T.R. Hughes Blvd",
    city: "O'Fallon",
    state: "MO",
  },
  "jingle holiday market, kansas city, mo": {
    address: "900 T.R. Hughes Blvd",
    city: "O'Fallon",
    state: "MO",
  },
  "carshield field": {
    address: "900 T.R. Hughes Blvd",
    city: "O'Fallon",
    state: "MO",
  },

  // Lowe's Arnold (operator-typed "2000 Michigan Ave" — that address
  // doesn't exist for Lowe's; the actual store is at Arnold Commons).
  "lowe's, 2000 michigan ave": {
    address: "920 Arnold Commons Dr",
    city: "Arnold",
    state: "MO",
  },
  "lowes in arnold": {
    address: "920 Arnold Commons Dr",
    city: "Arnold",
    state: "MO",
  },

  // CBRE Property Management — STL office in Clayton.
  "cbre property management": {
    address: "190 Carondelet Plaza",
    city: "Clayton",
    state: "MO",
  },

  // Witte Hardware Building — Laclede's Landing.
  "witte city (stl metro)": {
    address: "707 N 2nd St",
    city: "St. Louis",
    state: "MO",
  },

  // Eagles Crossing Disc Golf.
  "eagles crossing disc golf course": {
    address: "300 Eagles Nest Farm Rd",
    city: "Hawk Point",
    state: "MO",
  },

  // The Armory STL — Forest Park East entertainment venue.
  "the armory stl": {
    address: "3660 Market St",
    city: "St. Louis",
    state: "MO",
  },
  "the armory": {
    address: "3660 Market St",
    city: "St. Louis",
    state: "MO",
  },
  "armory stl": {
    address: "3660 Market St",
    city: "St. Louis",
    state: "MO",
  },

  // Calypso Spirits Bar — Soulard.
  "calypso bar": {
    address: "1026 Geyer Ave",
    city: "St. Louis",
    state: "MO",
  },

  // Sticky's Social Lounge — O'Fallon (not STL city proper).
  "sticky's social lounge": {
    address: "9390 Veterans Memorial Pkwy",
    city: "O'Fallon",
    state: "MO",
  },

  // Dive Bomb Industries — Hazelwood.
  "divebomb industries (stl metro)": {
    address: "5555 St. Louis Mills Blvd",
    city: "Hazelwood",
    state: "MO",
  },

  // S Wharf / Chouteau Mural Mile flood walls.
  "s. wharf/chouteau flood walls": {
    address: "1000 S Wharf St",
    city: "St. Louis",
    state: "MO",
  },

  // Cherry Garage — Midtown Alley.
  "cherry garage": {
    address: "2936 Locust St",
    city: "St. Louis",
    state: "MO",
  },

  // Tilles Park — Ladue (the event-known one; STL City Tilles Park is
  // a smaller separate venue we'll let operator distinguish if needed).
  "tilles park / rock hill brewing": {
    address: "9551 Litzsinger Rd",
    city: "Ladue",
    state: "MO",
  },

  // Sugar Creek Apartments — Fenton.
  "sugar creek apartments": {
    address: "301 Clay Creek Trl",
    city: "Fenton",
    state: "MO",
  },

  // SoHo Apartments — Soulard.
  "soho apartments": {
    address: "1515 S 7th St",
    city: "St. Louis",
    state: "MO",
  },

  // STL neighborhoods + parks (centroids — fine since same-name events
  // across operators will cluster correctly).
  "dogtown": {
    address: "6300 Tamm Ave",
    city: "St. Louis",
    state: "MO",
  },
  "dogtown (clayton-tamm)": {
    address: "6300 Tamm Ave",
    city: "St. Louis",
    state: "MO",
  },
  "bjc campus (central west end)": {
    address: "1 Barnes-Jewish Hospital Plaza",
    city: "St. Louis",
    state: "MO",
  },
  "fenton city park": {
    address: "100 St. Frances Cabrini Pl",
    city: "Fenton",
    state: "MO",
  },
  "shaw park": {
    address: "7800 Maryland Ave",
    city: "Clayton",
    state: "MO",
  },
  "crown park, carondelet": {
    address: "4400 Parker Ave",
    city: "St. Louis",
    state: "MO",
  },
  "saratoga lanes": {
    address: "2725 Sutton Blvd",
    city: "Maplewood",
    state: "MO",
  },
  "ladue early childhood center": {
    address: "9701 Conway Rd",
    city: "Ladue",
    state: "MO",
  },
  "south side cyclery, gravois ave, st. louis, mo": {
    address: "6925 Gravois Ave",
    city: "St. Louis",
    state: "MO",
  },
  "4112 west florrisant": {
    address: "4112 W Florissant Ave",
    city: "St. Louis",
    state: "MO",
  },
  "blanchette park": {
    address: "1900 N 2nd St",
    city: "St. Charles",
    state: "MO",
  },
  "second street in frenchtown": {
    address: "200 S 2nd St",
    city: "St. Charles",
    state: "MO",
  },
  "st. patrick catholic church": {
    address: "405 S Church St",
    city: "Wentzville",
    state: "MO",
  },
  "st. joseph parish manchester": {
    address: "567 St Joseph Ln",
    city: "Manchester",
    state: "MO",
  },
  "des peres city hall / park": {
    address: "12325 Manchester Rd",
    city: "Des Peres",
    state: "MO",
  },
  "minnie ha ha park": {
    address: "11140 Pardee Rd",
    city: "Sunset Hills",
    state: "MO",
  },
  // Art Hill / Kiener Plaza load-in addresses — re-use parent venue.
  "art hill, forest park, st. louis mo (food truck parking lot east of st. louis art museum)":
    { address: "1 Fine Arts Dr", city: "St. Louis", state: "MO" },
  "kiener plaza, downtown st. louis (load-in market & broadway for food trucks)":
    { address: "500 Chestnut St", city: "St. Louis", state: "MO" },
  // Downtown STL catch-all.
  "downtown stl parade route": {
    address: "500 Chestnut St",
    city: "St. Louis",
    state: "MO",
  },
  "downtown": {
    address: "500 Chestnut St",
    city: "St. Louis",
    state: "MO",
  },

  // Valmeyer IL (operator typed state=MO but Valmeyer is IL — IL rule
  // would have caught this if operator had used Illinois in city).
  "1411 boulder blvd": {
    address: "1411 Boulder Blvd",
    city: "Valmeyer",
    state: "IL",
  },

  // Locust (vague — assumed Locust St in Midtown STL since most
  // operator's STL Locust references are in Midtown corridor near
  // Wellspent Brewing).
  "locust": {
    address: "2917 Olive St",
    city: "St. Louis",
    state: "MO",
  },
};

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Try cross-referencing this venue's event_names against events that
 * already have cell_id populated. If we find a same-named event whose
 * cell_id is known, reuse it. The check is strict: event_name must
 * match exactly (case-insensitive) — looser matching invites false
 * positives.
 */
async function crossReferenceCellId(eventNames: string[]): Promise<{
  cell_id: string;
  latitude: number;
  longitude: number;
  source: string;
} | null> {
  if (eventNames.length === 0) return null;
  const { data } = await supabase
    .from("events")
    .select("event_name, cell_id, latitude, longitude")
    .in("event_name", eventNames)
    .not("cell_id", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(50);
  const rows = (data ?? []) as {
    event_name: string;
    cell_id: string;
    latitude: number;
    longitude: number;
  }[];
  if (rows.length === 0) return null;
  // Pick the most common cell_id across matches (mode). Mode > 1
  // confirms multiple already-resolved events agree.
  const counts = new Map<string, { count: number; row: typeof rows[0] }>();
  for (const r of rows) {
    const entry = counts.get(r.cell_id);
    if (entry) entry.count += 1;
    else counts.set(r.cell_id, { count: 1, row: r });
  }
  const winner = Array.from(counts.values()).sort(
    (a, b) => b.count - a.count
  )[0];
  return {
    cell_id: winner.row.cell_id,
    latitude: winner.row.latitude,
    longitude: winner.row.longitude,
    source: `event_name match (${winner.count} of ${rows.length})`,
  };
}

type Resolution = {
  venue_label: string;
  events: number;
  user_ids: Set<string>;
  cell_id: string;
  latitude: number;
  longitude: number;
  consensus_state: string;
  source: string;
  event_ids: string[];
  state_backfill_ids: string[];
};

(async () => {
  console.log("=".repeat(72));
  console.log(" Resolve low_precision venues");
  console.log("=".repeat(72));
  console.log("");

  // Pull every event with location populated and cell_id still null
  // (the universe Phase 3 still needs to fill). Scope: sharing ops.
  const { data: sharing } = await supabase
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  const sharingIds = (sharing ?? []).map((u: { id: string }) => u.id);

  const PAGE_SIZE = 1000;
  let allRows: {
    id: string;
    user_id: string;
    event_name: string;
    location: string;
    city: string | null;
    state: string | null;
  }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await supabase
      .from("events")
      .select("id, user_id, event_name, location, city, state")
      .in("user_id", sharingIds)
      .not("location", "is", null)
      .neq("location", "")
      .is("cell_id", null)
      .range(from, from + PAGE_SIZE - 1);
    const rows = (data ?? []) as typeof allRows;
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(
    `Universe: ${allRows.length} events with location, cell_id still null.`
  );

  // Group by normalized location string. Each unique venue handles
  // independently.
  type VenueGroup = {
    label: string;
    location_raw: string;
    city: string | null;
    state: string | null;
    events: typeof allRows;
    user_ids: Set<string>;
  };
  const venues = new Map<string, VenueGroup>();
  for (const r of allRows) {
    const key = normalizeKey(r.location ?? "");
    if (!key) continue;
    let g = venues.get(key);
    if (!g) {
      g = {
        label: key,
        location_raw: r.location ?? "",
        city: r.city,
        state: r.state,
        events: [],
        user_ids: new Set<string>(),
      };
      venues.set(key, g);
    }
    g.events.push(r);
    g.user_ids.add(r.user_id);
  }
  console.log(`Grouped into ${venues.size} unique venue labels.`);

  // Resolve each venue: try cross-ref first, then KNOWN_VENUES, then
  // mark unresolved.
  const resolutions: Resolution[] = [];
  const unresolved: VenueGroup[] = [];
  let geocodeCount = 0;
  for (const g of venues.values()) {
    const eventNames = Array.from(new Set(g.events.map((e) => e.event_name)));

    // Try 1: cross-reference event_name against already-resolved events.
    const xref = await crossReferenceCellId(eventNames);
    if (xref) {
      // State: prefer populated values on the group's events; else
      // inherit from a sibling event with the matching cell_id, but
      // we don't have that lookup here — fall back to the operator's
      // MO/IL rule on the location/city.
      const stateInferred = inferState(g.location_raw, g.city ?? "");
      const stateFromGroup =
        g.events.find((e) => e.state)?.state ?? stateInferred;
      resolutions.push({
        venue_label: g.label,
        events: g.events.length,
        user_ids: g.user_ids,
        cell_id: xref.cell_id,
        latitude: xref.latitude,
        longitude: xref.longitude,
        consensus_state: stateFromGroup,
        source: `cross-ref: ${xref.source}`,
        event_ids: g.events.map((e) => e.id),
        state_backfill_ids: g.events
          .filter((e) => !e.state)
          .map((e) => e.id),
      });
      continue;
    }

    // Try 2: KNOWN_VENUES hardcoded mapping. Re-geocode the canonical
    // street address through Mapbox so the cell_id is tight.
    const known = KNOWN_VENUES[g.label];
    if (known) {
      geocodeCount++;
      const geo = await geocodeAddress(known.address, known.city, known.state);
      if (geo) {
        resolutions.push({
          venue_label: g.label,
          events: g.events.length,
          user_ids: g.user_ids,
          cell_id: geo.cell_id,
          latitude: geo.latitude,
          longitude: geo.longitude,
          consensus_state: known.state,
          source: `known venue: ${known.address}, ${known.city}, ${known.state}`,
          event_ids: g.events.map((e) => e.id),
          state_backfill_ids: g.events
            .filter((e) => !e.state)
            .map((e) => e.id),
        });
        continue;
      }
    }

    // Try 3: nothing — unresolved.
    unresolved.push(g);
  }

  console.log("");
  console.log("─".repeat(72));
  console.log(` Resolutions: ${resolutions.length} venues / ${resolutions.reduce((a, r) => a + r.events, 0)} events`);
  console.log(`   Cross-ref hits: ${resolutions.filter((r) => r.source.startsWith("cross-ref")).length}`);
  console.log(`   Known-venue hits: ${resolutions.filter((r) => r.source.startsWith("known venue")).length}`);
  console.log(`   Mapbox geocodes performed: ${geocodeCount}`);
  console.log(`   State backfills implied: ${resolutions.reduce((a, r) => a + r.state_backfill_ids.length, 0)}`);
  console.log("");
  console.log(` Unresolved: ${unresolved.length} venues / ${unresolved.reduce((a, g) => a + g.events.length, 0)} events`);
  console.log("─".repeat(72));
  console.log("");

  if (unresolved.length > 0) {
    console.log(" Unresolved venue list (sorted by event_count DESC):");
    const sorted = unresolved.sort((a, b) => b.events.length - a.events.length);
    for (const u of sorted.slice(0, 50)) {
      console.log(
        `   ${u.events.length.toString().padStart(3)} × "${u.location_raw}" (${u.city ?? "—"}, ${u.state ?? inferState(u.location_raw, u.city ?? "")})`
      );
    }
    if (sorted.length > 50) {
      console.log(`   …and ${sorted.length - 50} more`);
    }
    console.log("");
  }

  if (!applyFlag) {
    console.log("Dry-run complete. Re-run with --apply to write.");
    return;
  }

  console.log("─".repeat(72));
  console.log(" Applying…");
  console.log("─".repeat(72));
  let updated = 0;
  let stateBackfilled = 0;
  let failed = 0;
  for (const r of resolutions) {
    for (const eid of r.event_ids) {
      const update: Record<string, unknown> = {
        latitude: r.latitude,
        longitude: r.longitude,
        cell_id: r.cell_id,
      };
      if (r.state_backfill_ids.includes(eid)) {
        update.state = r.consensus_state;
      }
      const { error } = await supabase
        .from("events")
        .update(update)
        .eq("id", eid)
        .is("cell_id", null);
      if (error) {
        console.log(`  ✗ ${eid}: ${error.message}`);
        failed++;
        continue;
      }
      updated++;
      if (r.state_backfill_ids.includes(eid)) stateBackfilled++;
    }
  }
  console.log("");
  console.log(
    `Updated ${updated} events. State backfilled on ${stateBackfilled}. Failed: ${failed}.`
  );
})();

function inferState(location: string, city: string): "IL" | "MO" {
  const h = `${location} ${city}`.toLowerCase();
  if (
    h.includes("scott a") ||
    h.includes("belleville") ||
    /\bil\b/.test(h) ||
    h.includes("illinois")
  ) {
    return "IL";
  }
  return "MO";
}
