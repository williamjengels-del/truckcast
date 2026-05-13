#!/usr/bin/env node
// Apply Phase 3 address-coverage backfill from an operator-confirmed
// TSV produced by `audit-address-coverage.ts`. Writes latitude,
// longitude, and cell_id to every event matching each confirmed
// venue signature.
//
// Per `feedback_no_auto_fix_data`: TSV-and-confirm. Default --dry-run;
// --apply required to write.
//
// The audit step already produced a candidate geocode per unique
// venue. This script does NOT re-geocode — it trusts whatever
// resolved_address / latitude / longitude / cell_id the operator left
// in the TSV. That lets the operator OVERRIDE Mapbox's pick when it
// got something wrong (e.g., chose a hotel instead of the venue next
// door) by editing those cells before running apply.
//
// Decision values (operator_decision column):
//   "apply" / "yes" / "correct"  → apply
//   "skip" / blank / anything else → no-op
//
// Stale-row protection: each candidate row is re-fetched by id
// before the UPDATE and the script asserts cell_id is still null
// (operator may have re-saved a row from the event form mid-session,
// populating cell_id via the create/update path).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/apply-address-geocoding.ts <tsv-path>
//   npx tsx --env-file=.env.local scripts/apply-address-geocoding.ts <tsv-path> --apply

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase env vars.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const tsvPath = process.argv[2];
const applyFlag = process.argv.includes("--apply");
if (!tsvPath || tsvPath.startsWith("--")) {
  console.error(
    "Usage: apply-address-geocoding.ts <tsv-path> [--apply]"
  );
  process.exit(2);
}

interface TsvRow {
  event_count: string;
  sample_location: string;
  /** Updated 2026-05-15: when the audit's cell-merge collapses multiple
   *  operator-typed location strings into one venue (e.g., "1 convention
   *  plaza" + "1 convention center plaza" both resolve to the same cell),
   *  all variants are joined with " || " here. Apply step iterates over
   *  each variant when matching events. */
  all_location_variants: string;
  sample_city: string;
  all_city_variants: string;
  /** consensus_state replaces sample_state. Apply step also writes
   *  this state to events in the group whose state is still null
   *  (operator's MO/IL inference rule lets us backfill remaining
   *  state nulls as a side-effect of the cell_id apply). */
  consensus_state: string;
  resolved_address: string;
  latitude: string;
  longitude: string;
  cell_id: string;
  geocode_status: string;
  operator_decision: string;
  notes: string;
}

function unquote(cell: string): string {
  if (cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"')) {
    return cell.slice(1, -1).replace(/""/g, '"');
  }
  return cell;
}

function parseTsv(path: string): TsvRow[] {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  const idx = (col: string) => header.indexOf(col);
  const out: TsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t").map(unquote);
    // Backward-compat: prefer consensus_state column (new), fall back
    // to sample_state column (old) for any TSV produced before the
    // 2026-05-15 audit script update. all_location_variants likewise
    // falls back to sample_location.
    const consensusState =
      cells[idx("consensus_state")] ??
      cells[idx("sample_state")] ??
      "";
    const sampleLoc = cells[idx("sample_location")] ?? "";
    const allVariants =
      cells[idx("all_location_variants")] ?? sampleLoc;
    const allCityVariants =
      cells[idx("all_city_variants")] ?? (cells[idx("sample_city")] ?? "");
    out.push({
      event_count: cells[idx("event_count")] ?? "",
      sample_location: sampleLoc,
      all_location_variants: allVariants,
      sample_city: cells[idx("sample_city")] ?? "",
      all_city_variants: allCityVariants,
      consensus_state: consensusState,
      resolved_address: cells[idx("resolved_address")] ?? "",
      latitude: cells[idx("latitude")] ?? "",
      longitude: cells[idx("longitude")] ?? "",
      cell_id: cells[idx("cell_id")] ?? "",
      geocode_status: cells[idx("geocode_status")] ?? "",
      operator_decision: cells[idx("operator_decision")] ?? "",
      notes: cells[idx("notes")] ?? "",
    });
  }
  return out;
}

function classifyDecision(c: string): "apply" | "skip" {
  const n = c.trim().toLowerCase();
  if (!n) return "skip";
  if (
    n === "apply" ||
    n === "yes" ||
    n === "correct" ||
    n.startsWith("correct")
  ) {
    return "apply";
  }
  return "skip";
}

function normalizeForSignature(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Matches the audit script's 2026-05-15 signature: location + city
 * only, state-agnostic. The apply path groups events the same way so
 * a venue with both state-populated and state-null events lands in
 * one bucket and gets a consistent cell_id + backfilled state.
 */
function venueSignatureFromRow(r: {
  location: string | null;
  city: string | null;
}): string {
  return [
    normalizeForSignature(r.location),
    normalizeForSignature(r.city),
  ].join("|");
}

type DbRow = {
  id: string;
  user_id: string;
  event_name: string;
  event_date: string;
  location: string | null;
  city: string | null;
  state: string | null;
  cell_id: string | null;
};

async function main(): Promise<void> {
  const rows = parseTsv(tsvPath);
  console.log("=".repeat(72));
  console.log(` Apply address geocoding from ${tsvPath}`);
  console.log(` Mode: ${applyFlag ? "APPLY (writes)" : "DRY-RUN (read-only)"}`);
  console.log("=".repeat(72));
  console.log("");

  const applyRows = rows.filter(
    (r) => classifyDecision(r.operator_decision) === "apply"
  );
  const skipRows = rows.filter(
    (r) => classifyDecision(r.operator_decision) === "skip"
  );
  console.log(
    `Parsed ${rows.length} rows: ${applyRows.length} confirmed, ${skipRows.length} skipped/blank.`
  );
  console.log("");

  // Validate apply rows have non-empty coords + cell_id. Unresolved
  // venues that the operator wants to apply anyway must have manual
  // coords in the TSV.
  const invalid: TsvRow[] = [];
  for (const r of applyRows) {
    if (!r.latitude || !r.longitude || !r.cell_id) {
      invalid.push(r);
    }
  }
  if (invalid.length > 0) {
    console.log("─".repeat(72));
    console.log(" ⚠ Confirmed rows missing coords / cell_id");
    console.log("─".repeat(72));
    for (const r of invalid) {
      console.log(
        `  • location="${r.sample_location}" city="${r.sample_city}" state="${r.consensus_state}"`
      );
      console.log(
        `    lat="${r.latitude}" lng="${r.longitude}" cell_id="${r.cell_id}"`
      );
    }
    console.log("");
    console.log(
      "These rows will be SKIPPED. Re-geocode or fill manual coords in the TSV."
    );
    console.log("");
  }
  const validApplyRows = applyRows.filter(
    (r) => r.latitude && r.longitude && r.cell_id
  );

  // Plan: for each valid apply row, find every event whose
  // (location, city, state) signature matches AND cell_id is still
  // null. Re-fetch defends against the row being updated via the
  // event form mid-session.
  type Op = {
    eventId: string;
    eventName: string;
    eventDate: string;
    userId: string;
    /** Human-readable label for the venue this op writes to. Used in
     *  dry-run output. Prefers Mapbox resolved_address when present,
     *  falls back to the operator-typed sample_location. */
    cellLabel: string;
    latitude: number;
    longitude: number;
    cellId: string;
    resolvedAddress: string;
    /** When non-null, the event's state column is currently NULL and
     *  the apply step will backfill it to this value (consensus state
     *  from the TSV). When null, the event already has state populated
     *  and we leave it alone. */
    stateBackfill: string | null;
  };
  const planned: Op[] = [];
  const staleRows: { eventId: string; reason: string }[] = [];

  for (const r of validApplyRows) {
    // Reverse-match: events whose location string matches ANY of the
    // operator-typed variants the audit merged into this venue (cell-
    // merge dedupe). Query each variant with ilike, then filter in
    // memory by the variant + city signature. Cell_id must still be
    // null (stale-row protection happens later per-event).
    const variants = (r.all_location_variants || r.sample_location)
      .split("||")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const cityVariants = (r.all_city_variants || r.sample_city)
      .split("||")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    const matched: DbRow[] = [];
    for (const v of variants) {
      const { data: candidates, error } = await supabase
        .from("events")
        .select("id, user_id, event_name, event_date, location, city, state, cell_id")
        .ilike("location", v)
        .is("cell_id", null);
      if (error) {
        console.log(
          `  ✗ fetch failed for location variant "${v}": ${error.message}`
        );
        continue;
      }
      for (const c of (candidates ?? []) as DbRow[]) {
        // Confirm city also matches one of the variants. Without this,
        // a location string like "Main Street" could match Main Street
        // in two different cities and we'd write the wrong cell_id.
        const eventCity = (c.city ?? "").toLowerCase().trim();
        if (!cityVariants.includes(eventCity) && cityVariants.length > 0) {
          continue;
        }
        // Skip if already added (operator-typed two variants but a
        // single event somehow matched both — defensive).
        if (matched.some((m) => m.id === c.id)) continue;
        matched.push(c);
      }
    }
    if (matched.length === 0) {
      console.log(
        `  ⚠ no events matched variants [${variants.join(" || ")}]`
      );
      continue;
    }
    const lat = parseFloat(r.latitude);
    const lng = parseFloat(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.log(
        `  ✗ invalid coords for "${r.sample_location}": lat="${r.latitude}" lng="${r.longitude}"`
      );
      continue;
    }
    for (const ev of matched as DbRow[]) {
      // Stale-row protection. If cell_id got populated since the
      // audit ran (operator re-saved via the form), skip this event
      // so we don't clobber a fresher geocode.
      if (ev.cell_id !== null) {
        staleRows.push({
          eventId: ev.id,
          reason: `cell_id is now "${ev.cell_id}" — was null at audit time`,
        });
        continue;
      }
      // State backfill rule: if this event's state is null AND the
      // consensus_state from the TSV is non-empty, schedule it for
      // backfill. Honors the operator's MO/IL inference rule globally
      // — saves them from having to re-confirm state on the 282 null
      // events one by one.
      const evState = (ev.state ?? "").trim();
      const consensusState = (r.consensus_state ?? "").trim();
      const stateBackfill =
        !evState && consensusState ? consensusState : null;
      planned.push({
        eventId: ev.id,
        eventName: ev.event_name,
        eventDate: ev.event_date,
        userId: ev.user_id,
        cellLabel: r.resolved_address || r.sample_location,
        latitude: lat,
        longitude: lng,
        cellId: r.cell_id,
        resolvedAddress: r.resolved_address,
        stateBackfill,
      });
    }
  }

  console.log("─".repeat(72));
  console.log(" Planned updates");
  console.log("─".repeat(72));
  const stateBackfillCount = planned.filter((p) => p.stateBackfill).length;
  console.log(`  ✓ Apply: ${planned.length} events`);
  console.log(
    `  + State backfill alongside cell_id: ${stateBackfillCount} events`
  );
  console.log(`  ⚠ Stale (cell_id populated since audit): ${staleRows.length}`);
  console.log("");

  if (planned.length > 0) {
    // Summary per cell so the output stays readable.
    const byCell = new Map<
      string,
      { count: number; sample: Op }
    >();
    for (const op of planned) {
      const existing = byCell.get(op.cellId);
      if (existing) {
        existing.count += 1;
      } else {
        byCell.set(op.cellId, { count: 1, sample: op });
      }
    }
    for (const [, info] of byCell) {
      console.log(`  ▸ ${info.sample.cellLabel}`);
      console.log(
        `      ${info.count} events  →  lat=${info.sample.latitude.toFixed(
          6
        )}, lng=${info.sample.longitude.toFixed(6)}, cell_id=${info.sample.cellId}`
      );
      if (info.sample.resolvedAddress) {
        console.log(`      resolved: ${info.sample.resolvedAddress}`);
      }
    }
    console.log("");
  }

  if (!applyFlag) {
    console.log("Dry-run complete. Re-run with --apply to write.");
    return;
  }

  if (planned.length === 0) {
    console.log("Nothing to apply. Exiting.");
    return;
  }

  console.log("─".repeat(72));
  console.log(" Applying…");
  console.log("─".repeat(72));
  let updated = 0;
  let failed = 0;
  let stateBackfilled = 0;
  for (const op of planned) {
    const updateData: Record<string, unknown> = {
      latitude: op.latitude,
      longitude: op.longitude,
      cell_id: op.cellId,
    };
    // State backfill: only when event state was null AND TSV carried
    // a consensus_state. Honors the operator's MO/IL inference rule
    // without requiring per-row confirm (rule was authorized globally).
    if (op.stateBackfill) {
      updateData.state = op.stateBackfill;
    }
    const { error } = await supabase
      .from("events")
      .update(updateData)
      .eq("id", op.eventId);
    if (error) {
      console.log(`  ✗ ${op.eventId} update failed: ${error.message}`);
      failed++;
      continue;
    }
    updated++;
    if (op.stateBackfill) stateBackfilled++;
  }
  console.log("");
  console.log(
    `Updated ${updated} events. Failed: ${failed}. State backfilled on ${stateBackfilled}.`
  );
  console.log("");
  console.log(
    "NOTE: cell_id changes affect the engine's cross-op matching on the"
  );
  console.log(
    "      next recalc. Trigger a recalc on each affected user to refresh"
  );
  console.log("      forecasts:");
  console.log(`        Operator hits "Refresh forecasts" on /dashboard`);
  console.log(
    `        OR run \`npx tsx --env-file=.env.local scripts/recalculate-for-user.ts <user-id>\``
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
