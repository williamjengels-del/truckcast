#!/usr/bin/env node
// Phase 3 of the address-required cross-op canonicalization workstream
// (Phase 2 sub-tree from planning doc). Read-only audit. Produces a
// per-venue TSV the operator scans to decide which historical events
// to backfill with geocoded lat/lng + cell_id.
//
// Per `feedback_no_auto_fix_data`: never auto-fix operator data.
// The audit step:
//   1. Finds every event with `location` populated but `cell_id` null.
//   2. Groups them by normalized venue signature (location + city +
//      state) so the operator reviews ~30-50 unique venues, not the
//      ~1,300 individual events the table has today (per planning doc
//      decision #3).
//   3. For each unique venue, calls Mapbox once to produce a candidate
//      resolution (address + lat/lng + cell_id). Mapbox calls are
//      bounded by unique venue count, typically well under 100.
//   4. Outputs TSV to stdout with columns the apply step consumes.
//      Operator fills the `operator_decision` column with "apply" /
//      "skip" / blank. Optionally overrides `resolved_address` if
//      Mapbox's pick is wrong.
//
// The apply step (`apply-address-geocoding.ts`) reads the TSV back and
// writes resolved lat/lng/cell_id to every matching event ONLY for
// rows the operator confirmed.
//
// Scope: default = all sharing operators (Wok-O + Best Wurst + Buzzy
// Bites and any future sharing ops). Use --user <uuid> to scope to one.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/audit-address-coverage.ts > audit-2026-05-14.tsv
//   npx tsx --env-file=.env.local scripts/audit-address-coverage.ts --user <uuid> > audit-woko.tsv

import { createClient } from "@supabase/supabase-js";
import { geocodeAddress } from "../src/lib/mapbox-geocoder.js";
import { US_STATE_NAMES } from "../src/lib/constants.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase env vars.");
  process.exit(2);
}
if (!process.env.MAPBOX_API_TOKEN) {
  console.error(
    "MAPBOX_API_TOKEN not set — audit cannot produce candidate geocodes."
  );
  console.error(
    "Drop the token in .env.local. The apply step will read this audit's"
  );
  console.error("resolved coords; running without the token here is useless.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const userIdx = process.argv.indexOf("--user");
const scopeUserId = userIdx >= 0 ? process.argv[userIdx + 1] : null;

/**
 * Normalize a venue field for grouping. Lowercase, collapse whitespace,
 * strip leading/trailing punctuation. Two events at the same venue
 * with slightly different operator-typed strings ("9 Mile Garden" vs
 * "9 mile garden ") collapse to the same signature.
 */
function normalizeForSignature(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Venue signature: (location, city) only, case-insensitive. State is
 * EXCLUDED to collapse state-null and state-populated rows for the same
 * physical venue into one group — operator's prior corrections set
 * state on 714 of 996 events, leaving 282 nulls. Without this collapse
 * the audit shows "9 Mile Garden | Affton | MO" and "9 Mile Garden |
 * Affton | (null)" as two separate venues, which is silly and forces
 * the operator to re-decide what they already decided.
 *
 * Per-group state inference (inferConsensusState below) fills the gap.
 */
function venueSignature(
  location: string | null,
  city: string | null
): string {
  return [
    normalizeForSignature(location),
    normalizeForSignature(city),
  ].join("|");
}

/**
 * Operator-locked rule (2026-05-15): default state for any event with
 * blank state = MO, UNLESS the row carries an explicit Illinois signal
 * (Scott AFB region, Belleville per v45 cleanup, or "IL"/"Illinois"
 * mentioned in city or location strings).
 *
 * This bypasses the per-event TSV review for state — the operator
 * authorized the rule globally. Used both for signature grouping
 * (inferred state guides Mapbox call) and as the consensus state
 * fallback when ALL events in a venue group have null state.
 */
function inferStateFromFields(
  location: string | null,
  city: string | null
): "IL" | "MO" {
  const haystack = `${(location ?? "")} ${(city ?? "")}`.toLowerCase();
  // Scott AFB / Belleville always IL per operator (v45 cleanup
  // established 50 Belleville rows → IL). Explicit "IL" or "illinois"
  // in either field also IL.
  if (
    haystack.includes("scott a") ||
    haystack.includes("belleville") ||
    /\bil\b/.test(haystack) ||
    haystack.includes("illinois")
  ) {
    return "IL";
  }
  return "MO";
}

/**
 * Consensus state for a venue group. Resolution order:
 *
 *   1. **IL override**: inferStateFromFields scans the sample
 *      location/city for clear IL signals (Scott AFB, Belleville,
 *      explicit "IL"/"Illinois"). When it fires, IL wins even over
 *      populated state values. Reason: operator's rule was authorized
 *      globally, and we discovered events where state was typed MO
 *      but the location was clearly an IL venue ("604 Tyler St, Scott
 *      AFB, Illinois 62225" with state="MO"). The rule is authoritative.
 *   2. **Populated mode**: any non-null state value, mode across the
 *      group. The operator's prior corrections drive consensus.
 *   3. **MO default**: no populated state and no IL signal → MO.
 *
 * Also reports how many events in the group are missing state — the
 * apply step uses this signal to backfill state alongside cell_id.
 */
function consensusStateFor(events: EventRow[]): {
  state: string;
  source: "populated" | "inferred";
  events_missing_state: number;
} {
  const populated = events
    .map((e) => e.state)
    .filter((s): s is string => !!s && s.trim().length > 0);
  const missingCount = events.length - populated.length;

  // Rule 1: IL signal overrides populated values when the location
  // clearly references an IL venue. Authorized by operator 2026-05-15.
  const sample = events[0];
  const inferred = inferStateFromFields(sample.location, sample.city);
  if (inferred === "IL") {
    return {
      state: "IL",
      source: "inferred",
      events_missing_state: missingCount,
    };
  }

  // Rule 2: populated mode wins when no IL override.
  if (populated.length > 0) {
    const counts = new Map<string, number>();
    for (const s of populated) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    return {
      state: sorted[0][0],
      source: "populated",
      events_missing_state: missingCount,
    };
  }

  // Rule 3: no populated state, no IL signal → MO default.
  return {
    state: inferred, // = "MO" here
    source: "inferred",
    events_missing_state: missingCount,
  };
}

type EventRow = {
  id: string;
  user_id: string;
  event_name: string;
  event_date: string;
  location: string | null;
  city: string | null;
  state: string | null;
};

type VenueBucket = {
  signature: string;
  sample_location: string;
  sample_city: string;
  /** Consensus state — populated mode if any event in the group has a
   *  non-null state, else applied via the inferStateFromFields rule. */
  consensus_state: string;
  consensus_state_source: "populated" | "inferred";
  events_missing_state: number;
  user_ids: Set<string>;
  events: EventRow[];
};

async function main(): Promise<void> {
  console.error("=".repeat(72));
  console.error(" Audit address coverage — pre-Phase-3 backfill review");
  console.error(` Scope: ${scopeUserId ?? "all sharing operators"}`);
  console.error("=".repeat(72));

  // Sharing operators (top-level only). The cell_id backfill only makes
  // sense for ops whose data contributes to the cross-op aggregate.
  const { data: sharingUsers } = await supabase
    .from("profiles")
    .select("id")
    .eq("data_sharing_enabled", true)
    .is("owner_user_id", null);
  const sharingIds = new Set(
    (sharingUsers ?? []).map((u: { id: string }) => u.id)
  );
  if (sharingIds.size === 0) {
    console.error("No sharing operators found. Nothing to audit.");
    process.exit(0);
  }
  const scopedIds = scopeUserId
    ? [scopeUserId]
    : Array.from(sharingIds);
  if (scopeUserId && !sharingIds.has(scopeUserId)) {
    console.error(
      `Warning: --user ${scopeUserId} is NOT sharing-enabled. Audit will`
    );
    console.error(
      `still run but the backfill won't surface in cross-op aggregates`
    );
    console.error(`until the operator enables sharing.`);
  }

  // Fetch every event with a location but no cell_id. Paginated to
  // avoid Supabase's default row limit (1000); food-truck operators
  // typically have ~1,000-1,500 events each.
  const PAGE_SIZE = 1000;
  let allRows: EventRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("events")
      .select("id, user_id, event_name, event_date, location, city, state")
      .in("user_id", scopedIds)
      .not("location", "is", null)
      .neq("location", "")
      .is("cell_id", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`Fetch failed: ${error.message}`);
      process.exit(1);
    }
    const rows = (data ?? []) as EventRow[];
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break;
  }

  console.error(`Found ${allRows.length} events with location but no cell_id.`);
  if (allRows.length === 0) {
    console.error(
      "Everything already has cell_id — Phase 3 backfill is complete."
    );
    process.exit(0);
  }

  // Group by venue signature (location + city, ignoring state). Track
  // all events per signature so the apply step can write to every
  // matching event in one batch. State is filled per-group via the
  // consensus rule below — operator's prior state corrections drive
  // the consensus when populated; falls back to the operator's
  // Missouri-default rule (Belleville/Scott-AFB/IL signal → IL, else
  // MO) when ALL events in the group are state-null.
  type ProtoBucket = {
    signature: string;
    sample_location: string;
    sample_city: string;
    user_ids: Set<string>;
    events: EventRow[];
  };
  const protoBuckets = new Map<string, ProtoBucket>();
  for (const r of allRows) {
    const sig = venueSignature(r.location, r.city);
    if (!sig.replace(/\|/g, "").trim()) continue; // pure-empty signature, skip
    let bucket = protoBuckets.get(sig);
    if (!bucket) {
      bucket = {
        signature: sig,
        sample_location: r.location ?? "",
        sample_city: r.city ?? "",
        user_ids: new Set<string>(),
        events: [],
      };
      protoBuckets.set(sig, bucket);
    }
    bucket.user_ids.add(r.user_id);
    bucket.events.push(r);
  }

  // Finalize buckets with consensus state.
  const buckets = new Map<string, VenueBucket>();
  for (const [sig, p] of protoBuckets) {
    const consensus = consensusStateFor(p.events);
    buckets.set(sig, {
      ...p,
      consensus_state: consensus.state,
      consensus_state_source: consensus.source,
      events_missing_state: consensus.events_missing_state,
    });
  }

  const inferredCount = Array.from(buckets.values()).filter(
    (b) => b.consensus_state_source === "inferred"
  ).length;
  console.error(
    `Grouped into ${buckets.size} unique venue signatures (location + city, state-agnostic).`
  );
  console.error(
    `  ${buckets.size - inferredCount} have populated state in at least one event (consensus picks the most common).`
  );
  console.error(
    `  ${inferredCount} have NO populated state; defaulted via Missouri rule (Belleville/Scott AFB/IL signal → IL, else MO).`
  );
  console.error(`Geocoding each via Mapbox (one call per venue)…`);

  // Sort by event count DESC so operator sees highest-impact venues
  // first when scanning the TSV.
  const sortedBuckets = Array.from(buckets.values()).sort(
    (a, b) => b.events.length - a.events.length
  );

  // Geocode each unique venue. Mapbox free-tier headroom is 100K/month;
  // 30-100 calls is trivial.
  //
  // Quality flag (added 2026-05-15 after first audit pass): Mapbox returns
  // SOMETHING for almost any input string. When the operator typed a
  // venue NAME ("9 Mile Garden") rather than a street address, Mapbox
  // often guesses wildly — "9 Mile Garden, Affton, MO" resolved to
  // "Nine-mile, Butte, Montana" on the first pass. Without a state-
  // mismatch detector, operator would have to spot-check every row
  // for these silent misses. The match_quality column lets operator
  // sort/filter and bulk-skip the suspicious ones.
  type MatchQuality = "ok" | "state_mismatch" | "low_precision" | "unresolved";
  type EnrichedBucket = VenueBucket & {
    resolved_address: string;
    latitude: number | null;
    longitude: number | null;
    cell_id: string | null;
    geocode_status: "ok" | "unresolved";
    match_quality: MatchQuality;
  };

  /**
   * Classify the match quality based on whether the resolved address
   * contains the operator's stated state. State match is the strongest
   * signal — if "Missouri" or "MO" doesn't appear in a resolution where
   * the operator said the event is in MO, the geocoder picked something
   * elsewhere (the 9 Mile Garden → Montana case).
   *
   * Returns "ok" when both state matches AND the resolved address
   * appears to contain a street number (suggests street-level precision).
   * Returns "low_precision" when state matches but the address is city/
   * region-level (no street number, just "St. Ann, Missouri"). Returns
   * "state_mismatch" when the resolved address doesn't mention the
   * operator's state at all.
   *
   * Empty operator state → "ok" (we can't validate, but no signal that
   * it's wrong either).
   */
  function classifyMatch(
    operatorState: string,
    resolvedAddress: string
  ): MatchQuality {
    const trimmedState = (operatorState ?? "").trim().toUpperCase();
    const resolved = (resolvedAddress ?? "").toLowerCase();
    if (!trimmedState || trimmedState === "OTHER") {
      // Can't validate — treat as ok and let operator decide.
      return inferStreetLevel(resolved) ? "ok" : "low_precision";
    }
    const fullName = US_STATE_NAMES[trimmedState];
    const abbrPattern = new RegExp(`\\b${trimmedState}\\b`, "i");
    const fullPattern = fullName
      ? new RegExp(`\\b${fullName}\\b`, "i")
      : null;
    const hasState =
      abbrPattern.test(resolved) ||
      (fullPattern !== null && fullPattern.test(resolved));
    if (!hasState) return "state_mismatch";
    return inferStreetLevel(resolved) ? "ok" : "low_precision";
  }

  /**
   * Cheap heuristic: does the resolved address start with a street number?
   * Mapbox street-level resolutions look like "5372 Saint Charles
   * Street, Cottleville, Missouri 63304". City/region resolutions look
   * like "St. Ann, Missouri, United States". Numeric prefix is a strong
   * street-level signal.
   */
  function inferStreetLevel(resolved: string): boolean {
    return /^\s*\d/.test(resolved);
  }
  const enriched: EnrichedBucket[] = [];
  let geocodeCount = 0;
  for (const b of sortedBuckets) {
    geocodeCount++;
    if (geocodeCount % 10 === 0) {
      console.error(`  …${geocodeCount}/${sortedBuckets.length}`);
    }
    const geo = await geocodeAddress(
      b.sample_location,
      b.sample_city,
      b.consensus_state
    );
    if (geo) {
      const quality = classifyMatch(b.consensus_state, geo.resolved_address);
      enriched.push({
        ...b,
        resolved_address: geo.resolved_address,
        latitude: geo.latitude,
        longitude: geo.longitude,
        cell_id: geo.cell_id,
        geocode_status: "ok",
        match_quality: quality,
      });
    } else {
      enriched.push({
        ...b,
        resolved_address: "",
        latitude: null,
        longitude: null,
        cell_id: null,
        geocode_status: "unresolved",
        match_quality: "unresolved",
      });
    }
  }

  // Post-geocode merge: signatures that resolved to the same cell_id
  // are the same physical venue typed differently by the operator
  // ("1 convention plaza" + "1 convention center plaza" both resolve
  // to the same Mapbox cell). Collapse them into one TSV row so the
  // operator sees one logical venue instead of N variants.
  //
  // Apply step parses the all_location_variants column on each row
  // and matches events against ANY of the listed location strings.
  // Unresolved venues (cell_id null) stay one TSV row per signature
  // — no canonical key to merge on.
  type MergedBucket = EnrichedBucket & {
    /** All location strings the operator has used for this venue.
     *  Comma-separated; first entry is the highest-event-count one
     *  (kept as sample_location). Apply step iterates over this list. */
    all_location_variants: string;
    /** Mirror for cities — usually the same string, but operator
     *  may have used variants ("St. Louis" vs "Saint Louis"). */
    all_city_variants: string;
  };
  const mergedByCell = new Map<string, EnrichedBucket[]>();
  const unmerged: EnrichedBucket[] = [];
  for (const b of enriched) {
    if (b.cell_id) {
      if (!mergedByCell.has(b.cell_id)) mergedByCell.set(b.cell_id, []);
      mergedByCell.get(b.cell_id)!.push(b);
    } else {
      unmerged.push(b);
    }
  }
  const merged: MergedBucket[] = [];
  for (const [, group] of mergedByCell) {
    // Sort within group by event_count DESC so the most-used variant
    // becomes the canonical sample.
    group.sort((a, b) => b.events.length - a.events.length);
    const primary = group[0];
    // Union all events, recompute operator_count + state consensus
    // across the merged set.
    const allEvents = group.flatMap((g) => g.events);
    const allUserIds = new Set<string>();
    for (const g of group) for (const u of g.user_ids) allUserIds.add(u);
    const mergedConsensus = consensusStateFor(allEvents);
    const variantLocations = Array.from(
      new Set(group.map((g) => g.sample_location.trim()).filter(Boolean))
    );
    const variantCities = Array.from(
      new Set(group.map((g) => g.sample_city.trim()).filter(Boolean))
    );
    merged.push({
      ...primary,
      user_ids: allUserIds,
      events: allEvents,
      consensus_state: mergedConsensus.state,
      consensus_state_source: mergedConsensus.source,
      events_missing_state: mergedConsensus.events_missing_state,
      all_location_variants: variantLocations.join(" || "),
      all_city_variants: variantCities.join(" || "),
    });
  }
  for (const u of unmerged) {
    merged.push({
      ...u,
      all_location_variants: u.sample_location,
      all_city_variants: u.sample_city,
    });
  }

  const okCount = merged.filter((b) => b.match_quality === "ok").length;
  const lowPrecCount = merged.filter(
    (b) => b.match_quality === "low_precision"
  ).length;
  const mismatchCount = merged.filter(
    (b) => b.match_quality === "state_mismatch"
  ).length;
  const unresolvedCount = merged.filter(
    (b) => b.geocode_status === "unresolved"
  ).length;
  const mergedAwayCount = enriched.length - merged.length;
  console.error(
    `Cell-merge collapsed ${enriched.length} signatures → ${merged.length} unique venues (${mergedAwayCount} variants merged into canonical rows).`
  );
  console.error(
    `Done. ${okCount} ok, ${lowPrecCount} low_precision, ${mismatchCount} state_mismatch, ${unresolvedCount} unresolved.`
  );
  console.error("");
  console.error("Writing TSV to stdout. Redirect to a file for review:");
  console.error("  > audit-address-coverage-YYYY-MM-DD.tsv");
  console.error("");
  console.error("Operator workflow:");
  console.error("  1. Open the TSV in Excel/Google Sheets.");
  console.error(
    "  2. Scan rows — they're sorted by event_count DESC so highest-impact"
  );
  console.error("     venues are at the top.");
  console.error(
    "  3. For each row, fill operator_decision: 'apply' / 'skip' / blank."
  );
  console.error(
    "     If Mapbox's resolved_address is wrong, you can OVERRIDE latitude,"
  );
  console.error(
    "     longitude, cell_id directly in the TSV — the apply step trusts"
  );
  console.error(
    "     whatever's in those cells (it does NOT re-geocode on apply)."
  );
  console.error(
    "  4. Save the TSV, run scripts/apply-address-geocoding.ts <tsv> [--apply]."
  );
  console.error("");

  // Sort: ok rows first (sorted by event_count DESC so highest-impact at
  // top), then low_precision, then state_mismatch, then unresolved. Within
  // each quality bucket, preserve the event_count DESC ordering. This
  // puts the operator's review work in priority order: confident matches
  // up top, suspicious ones at the bottom for bulk-skip.
  const qualityRank: Record<MatchQuality, number> = {
    ok: 0,
    low_precision: 1,
    state_mismatch: 2,
    unresolved: 3,
  };
  merged.sort((a, b) => {
    const ra = qualityRank[a.match_quality];
    const rb = qualityRank[b.match_quality];
    if (ra !== rb) return ra - rb;
    return b.events.length - a.events.length;
  });

  console.error("");
  console.error("Tip: in Excel/Sheets, filter by match_quality:");
  console.error(
    "  • 'ok'           — confident matches, the bulk-apply candidates"
  );
  console.error(
    "  • 'low_precision' — resolved to the right city/region but no street"
  );
  console.error(
    "                     number; cell_id is a city-area centroid. Useful"
  );
  console.error(
    "                     fallback when operator typed a venue name."
  );
  console.error(
    "  • 'state_mismatch' — Mapbox picked an address in a different state"
  );
  console.error(
    "                     than you typed. Almost always a bad pick. Bulk-"
  );
  console.error(
    "                     skip these or fix the operator's location string"
  );
  console.error("                     upstream first.");
  console.error("");

  // TSV header. consensus_state replaces sample_state — operator sees
  // the value that drove the Mapbox call. events_missing_state shows
  // how many rows in the group will ALSO get state backfilled when
  // apply runs. all_location_variants lists every operator-typed
  // location string that resolved to this venue — apply step matches
  // events using ANY variant.
  const headers = [
    "match_quality",
    "event_count",
    "operator_count",
    "sample_location",
    "all_location_variants",
    "sample_city",
    "all_city_variants",
    "consensus_state",
    "consensus_state_source",
    "events_missing_state",
    "resolved_address",
    "latitude",
    "longitude",
    "cell_id",
    "geocode_status",
    "operator_decision",
    "notes",
  ];
  process.stdout.write(headers.join("\t") + "\n");
  for (const b of merged) {
    const row = [
      b.match_quality,
      String(b.events.length),
      String(b.user_ids.size),
      b.sample_location,
      b.all_location_variants,
      b.sample_city,
      b.all_city_variants,
      b.consensus_state,
      b.consensus_state_source,
      String(b.events_missing_state),
      b.resolved_address,
      b.latitude !== null ? b.latitude.toFixed(6) : "",
      b.longitude !== null ? b.longitude.toFixed(6) : "",
      b.cell_id ?? "",
      b.geocode_status,
      "",
      "",
    ];
    process.stdout.write(row.map((c) => c.replace(/\t/g, " ")).join("\t") + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
