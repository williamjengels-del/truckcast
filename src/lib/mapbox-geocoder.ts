// Mapbox geocoder + cell_id derivation for cross-operator address-
// keyed canonicalization (Phase 2 of the address-required workstream,
// Phase 1 of that sub-tree: input layer only — engine integration is
// a separate session).
//
// Server-side only. MAPBOX_API_TOKEN env var has no NEXT_PUBLIC_ prefix
// on purpose so Next.js refuses to ship it to the client bundle. The
// resolved-address preview on the form goes through /api/geocode/address
// which proxies the token-bearing call.
//
// Token-absent posture: every entry point returns null silently. The
// event-form save path is wired to skip writing cell_id when geocoding
// is disabled, so the column stays null and the engine falls back to
// name-keyed cross-op matching (current behavior). Drop the env var
// in Vercel + .env.local to activate.
//
// Mapbox free tier: 100K geocoding requests/month. At 30-op scale with
// typical usage we sit around 1.5% of quota — there's no surprise-bill
// risk and Mapbox auto-rate-limits past quota (HTTP 429), it doesn't
// charge without explicit paid-plan opt-in.
//
// Residual abuse vector flagged in PR body: a logged-in operator could
// chew through quota fast (e.g. ~3,300 geocodes per day if they spam
// the API route). Mitigation deferred until we cross ~20 sharing ops or
// see quota usage climb. Application-side per-user rate-limit is the
// fix; not load-bearing today since the operator set is trusted.

const MAPBOX_GEOCODE_BASE = "https://api.mapbox.com/search/geocode/v6/forward";

/**
 * cell_id grid precision: 1/1000 of a degree on both axes.
 *   latitude:  ~111m N-S (constant)
 *   longitude: varies with latitude. ~100m at the equator; ~87m at
 *              38°N (St. Louis); ~78m at 45°N. Good enough to cluster
 *              "same venue" events while tolerating Mapbox-geocode
 *              jitter on repeat lookups of the same address string.
 */
const CELL_PRECISION_FACTOR = 1000;

export type GeocodeResult = {
  /** Mapbox-resolved canonical place name, e.g. "6379 S Lindbergh Blvd, Affton, MO 63123". */
  resolved_address: string;
  latitude: number;
  longitude: number;
  cell_id: string;
};

/**
 * Is the geocoder available right now? Used by the event-form save
 * path to decide whether to attempt geocoding at all. Returning false
 * is the indicator that the cell_id column stays null and the engine
 * falls back to existing name-keyed cross-op match.
 */
export function isGeocodingEnabled(): boolean {
  return !!process.env.MAPBOX_API_TOKEN;
}

/**
 * Derive a 100m grid cell key from lat/lng. Public so the engine v2
 * read-path (Phase 2) can derive the same key from a queried event's
 * coords without re-implementing the math.
 */
export function deriveCellId(latitude: number, longitude: number): string {
  const latKey = Math.round(latitude * CELL_PRECISION_FACTOR);
  const lngKey = Math.round(longitude * CELL_PRECISION_FACTOR);
  return `${latKey}_${lngKey}`;
}

/**
 * Geocode a venue address. Server-side only — uses MAPBOX_API_TOKEN
 * directly. Returns null on:
 *   * token unset (graceful no-op)
 *   * Mapbox API failure / rate-limit
 *   * empty / unresolvable input
 *
 * Inputs:
 *   address — operator-typed venue or street address. Required.
 *   city + state — optional context; appended to improve match
 *     accuracy. The events table already has these as separate
 *     columns; we concatenate at geocode time.
 *
 * Strategy:
 *   1. Build a search string: `${address}, ${city}, ${state}` (omitting
 *      blanks).
 *   2. Hit Mapbox v6 forward geocoder with `country=us` (operator base
 *      is US-only per project_metro_targeting.md).
 *   3. Take the first feature. Mapbox sorts by relevance + proximity;
 *      first result is the canonical match.
 *   4. Derive cell_id from the geometry.
 *
 * Note: we deliberately don't use proximity biasing (e.g. operator's
 * profile city as the proximity point). For VendCast the operator
 * gives the city explicitly with each event, and biasing by profile
 * city would bias against legitimate out-of-state events.
 */
export async function geocodeAddress(
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined
): Promise<GeocodeResult | null> {
  const token = process.env.MAPBOX_API_TOKEN;
  if (!token) return null;

  const trimmedAddress = (address ?? "").trim();
  if (!trimmedAddress) return null;

  const parts = [trimmedAddress];
  const trimmedCity = (city ?? "").trim();
  const trimmedState = (state ?? "").trim();
  if (trimmedCity) parts.push(trimmedCity);
  if (trimmedState && trimmedState !== "OTHER") parts.push(trimmedState);
  const query = parts.join(", ");

  const url = new URL(MAPBOX_GEOCODE_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("country", "us");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as MapboxV6Response;
    const feature = data.features?.[0];
    if (!feature) return null;

    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [longitude, latitude] = coords;
    if (typeof latitude !== "number" || typeof longitude !== "number") return null;

    const resolved =
      feature.properties?.full_address ??
      feature.properties?.place_formatted ??
      feature.properties?.name ??
      query;

    return {
      resolved_address: resolved,
      latitude,
      longitude,
      cell_id: deriveCellId(latitude, longitude),
    };
  } catch {
    return null;
  }
}

/**
 * Minimal shape we read out of Mapbox v6's response. Defined inline
 * because we only consume a few fields and pulling in their full SDK
 * types isn't worth a dep.
 */
type MapboxV6Response = {
  features?: Array<{
    properties?: {
      full_address?: string;
      place_formatted?: string;
      name?: string;
    };
    geometry?: {
      coordinates?: [number, number]; // [lng, lat]
    };
  }>;
};
