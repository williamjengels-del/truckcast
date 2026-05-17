// Backfill geocoding for events that have a location string but no
// cell_id — the gap that lets imported historical data sit invisible
// to the cross-operator forecast engine.
//
// Why this exists: event-form create/update geocode inline, but CSV /
// Sheets imports insert events with location + city + state and never
// geocode. Every operator who onboards by importing historical data
// gets events with cell_id NULL, so that data contributes to cross-op
// matching only via exact event-name match — not the cell-based match
// that catches same-venue / different-name overlaps. This function is
// called after an import (and is safe to call from a recalc / cron as
// a self-healing pass) to close that gap.
//
// Quality gate: only STREET-LEVEL, right-state geocodes are written.
// A city-centroid result ("St. Louis, Missouri") would give a dozen
// distinct downtown venues the SAME cell_id and falsely cluster their
// revenue in the cross-op aggregate. Those low-precision rows are left
// with cell_id NULL — they still match cross-op by event name, and the
// operator-facing low-precision resolver can tighten them later.

import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress, isGeocodingEnabled } from "./mapbox-geocoder";
import { US_STATE_NAMES } from "./constants";

type PendingEvent = {
  id: string;
  location: string | null;
  city: string | null;
  state: string | null;
};

export type GeocodeUserEventsResult = {
  /** Events with a location but no cell_id at the start of the run. */
  pendingEvents: number;
  /** Distinct venue signatures across those events. */
  uniqueVenues: number;
  /** Venues that resolved to a confident street-level coordinate. */
  venuesResolved: number;
  /** Venues skipped — unresolved, city-centroid, or wrong-state. */
  venuesSkippedLowQuality: number;
  /** Event rows that received a cell_id. */
  eventsUpdated: number;
};

/** Venue grouping key — location + city, normalized. Mirrors the
 *  signature used by scripts/audit-address-coverage.ts so the import
 *  pass and the operator-facing audit cluster events the same way. */
function venueSignature(location: string | null, city: string | null): string {
  const norm = (s: string | null) =>
    (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(location)}|${norm(city)}`;
}

/** A Mapbox street-level resolution starts with a street number
 *  ("9375 Gravois Rd, …"). City/region centroids don't ("St. Louis,
 *  Missouri, …"). Numeric prefix is the cheap street-level signal. */
function isStreetLevel(resolvedAddress: string): boolean {
  return /^\s*\d/.test(resolvedAddress);
}

/** Does the resolved address actually sit in the state the operator
 *  said? Catches venue-name geocodes that landed in the wrong state
 *  (the classic "9 Mile Garden" → "Nine-mile, Butte, Montana"). When
 *  the operator gave no state we can't validate — don't block. */
function stateMatches(state: string | null, resolvedAddress: string): boolean {
  const code = (state ?? "").trim().toUpperCase();
  if (!code || code === "OTHER") return true;
  if (new RegExp(`\\b${code}\\b`, "i").test(resolvedAddress)) return true;
  const fullName = US_STATE_NAMES[code];
  return fullName
    ? resolvedAddress.toLowerCase().includes(fullName.toLowerCase())
    : false;
}

/**
 * Geocode every event for `userId` that has a location but no cell_id.
 * Dedups by venue so a 1,000-event import costs ~one Mapbox call per
 * distinct venue, not per event. Best-effort: returns counts, never
 * throws on a single bad geocode.
 *
 * `client` must be able to SELECT + UPDATE the user's events — either
 * the operator's own RLS-scoped client or a service-role client.
 */
export async function geocodeUserEvents(
  userId: string,
  client: SupabaseClient,
  opts: { maxVenues?: number } = {}
): Promise<GeocodeUserEventsResult> {
  const result: GeocodeUserEventsResult = {
    pendingEvents: 0,
    uniqueVenues: 0,
    venuesResolved: 0,
    venuesSkippedLowQuality: 0,
    eventsUpdated: 0,
  };
  if (!isGeocodingEnabled()) return result;

  // Fetch pending events, paginated past PostgREST's 1000-row default.
  const pending: PendingEvent[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("events")
      .select("id, location, city, state")
      .eq("user_id", userId)
      .not("location", "is", null)
      .neq("location", "")
      .is("cell_id", null)
      .range(from, from + PAGE - 1);
    if (error) return result;
    const rows = (data ?? []) as PendingEvent[];
    pending.push(...rows);
    if (rows.length < PAGE) break;
  }
  result.pendingEvents = pending.length;
  if (pending.length === 0) return result;

  // Group by venue signature.
  const venues = new Map<string, PendingEvent[]>();
  for (const e of pending) {
    const sig = venueSignature(e.location, e.city);
    if (!sig.replace(/\|/g, "").trim()) continue;
    const bucket = venues.get(sig);
    if (bucket) bucket.push(e);
    else venues.set(sig, [e]);
  }
  result.uniqueVenues = venues.size;

  const maxVenues = opts.maxVenues ?? 500;
  let processed = 0;
  for (const group of venues.values()) {
    if (processed >= maxVenues) break;
    processed++;

    const sample = group[0];
    const geo = await geocodeAddress(sample.location, sample.city, sample.state);
    if (
      !geo ||
      !isStreetLevel(geo.resolved_address) ||
      !stateMatches(sample.state, geo.resolved_address)
    ) {
      result.venuesSkippedLowQuality++;
      continue;
    }

    const ids = group.map((e) => e.id);
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error, count } = await client
        .from("events")
        .update(
          {
            latitude: geo.latitude,
            longitude: geo.longitude,
            cell_id: geo.cell_id,
          },
          { count: "exact" }
        )
        .in("id", ids.slice(i, i + CHUNK))
        .is("cell_id", null);
      if (!error) result.eventsUpdated += count ?? 0;
    }
    result.venuesResolved++;
  }
  return result;
}
