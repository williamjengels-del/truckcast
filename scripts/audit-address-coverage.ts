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

function venueSignature(
  location: string | null,
  city: string | null,
  state: string | null
): string {
  return [
    normalizeForSignature(location),
    normalizeForSignature(city),
    normalizeForSignature(state),
  ].join("|");
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
  sample_state: string;
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

  // Group by venue signature. Track all events per signature so the
  // apply step can write to every matching event in one batch.
  const buckets = new Map<string, VenueBucket>();
  for (const r of allRows) {
    const sig = venueSignature(r.location, r.city, r.state);
    if (!sig.replace(/\|/g, "").trim()) continue; // pure-empty signature, skip
    let bucket = buckets.get(sig);
    if (!bucket) {
      bucket = {
        signature: sig,
        sample_location: r.location ?? "",
        sample_city: r.city ?? "",
        sample_state: r.state ?? "",
        user_ids: new Set<string>(),
        events: [],
      };
      buckets.set(sig, bucket);
    }
    bucket.user_ids.add(r.user_id);
    bucket.events.push(r);
  }

  console.error(`Grouped into ${buckets.size} unique venue signatures.`);
  console.error(`Geocoding each via Mapbox (one call per venue)…`);

  // Sort by event count DESC so operator sees highest-impact venues
  // first when scanning the TSV.
  const sortedBuckets = Array.from(buckets.values()).sort(
    (a, b) => b.events.length - a.events.length
  );

  // Geocode each unique venue. Mapbox free-tier headroom is 100K/month;
  // 30-100 calls is trivial.
  type EnrichedBucket = VenueBucket & {
    resolved_address: string;
    latitude: number | null;
    longitude: number | null;
    cell_id: string | null;
    geocode_status: "ok" | "unresolved";
  };
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
      b.sample_state
    );
    if (geo) {
      enriched.push({
        ...b,
        resolved_address: geo.resolved_address,
        latitude: geo.latitude,
        longitude: geo.longitude,
        cell_id: geo.cell_id,
        geocode_status: "ok",
      });
    } else {
      enriched.push({
        ...b,
        resolved_address: "",
        latitude: null,
        longitude: null,
        cell_id: null,
        geocode_status: "unresolved",
      });
    }
  }

  const unresolvedCount = enriched.filter(
    (b) => b.geocode_status === "unresolved"
  ).length;
  console.error(
    `Done. ${enriched.length - unresolvedCount} resolved, ${unresolvedCount} unresolved.`
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

  // TSV header
  const headers = [
    "signature",
    "event_count",
    "operator_count",
    "sample_location",
    "sample_city",
    "sample_state",
    "resolved_address",
    "latitude",
    "longitude",
    "cell_id",
    "geocode_status",
    "operator_decision",
    "notes",
  ];
  process.stdout.write(headers.join("\t") + "\n");
  for (const b of enriched) {
    const row = [
      b.signature,
      String(b.events.length),
      String(b.user_ids.size),
      b.sample_location,
      b.sample_city,
      b.sample_state,
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
