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
  signature: string;
  event_count: string;
  sample_location: string;
  sample_city: string;
  sample_state: string;
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
    out.push({
      signature: cells[idx("signature")] ?? "",
      event_count: cells[idx("event_count")] ?? "",
      sample_location: cells[idx("sample_location")] ?? "",
      sample_city: cells[idx("sample_city")] ?? "",
      sample_state: cells[idx("sample_state")] ?? "",
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

function venueSignatureFromRow(r: {
  location: string | null;
  city: string | null;
  state: string | null;
}): string {
  return [
    normalizeForSignature(r.location),
    normalizeForSignature(r.city),
    normalizeForSignature(r.state),
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
      console.log(`  • signature: ${r.signature}`);
      console.log(
        `    location="${r.sample_location}" city="${r.sample_city}" state="${r.sample_state}"`
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
    signature: string;
    latitude: number;
    longitude: number;
    cellId: string;
    resolvedAddress: string;
  };
  const planned: Op[] = [];
  const staleRows: { eventId: string; reason: string }[] = [];

  for (const r of validApplyRows) {
    // Reverse-match: query events with matching location/city/state
    // strings (case-insensitive) AND cell_id null. Scope to all sharing
    // ops since the audit script defaults to all sharing ops.
    // We use ilike for case-insensitive equality on the raw string
    // since the signature normalization happens in code, not in
    // Postgres.
    const { data: candidates, error } = await supabase
      .from("events")
      .select("id, user_id, event_name, event_date, location, city, state, cell_id")
      .ilike("location", r.sample_location.trim())
      .is("cell_id", null);
    if (error) {
      console.log(
        `  ✗ fetch failed for signature "${r.signature}": ${error.message}`
      );
      continue;
    }
    const matched = (candidates ?? []).filter((c: DbRow) => {
      const sig = venueSignatureFromRow(c);
      return sig === r.signature;
    });
    if (matched.length === 0) {
      console.log(`  ⚠ no events matched signature "${r.signature}"`);
      continue;
    }
    const lat = parseFloat(r.latitude);
    const lng = parseFloat(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.log(
        `  ✗ invalid coords for signature "${r.signature}": lat="${r.latitude}" lng="${r.longitude}"`
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
      planned.push({
        eventId: ev.id,
        eventName: ev.event_name,
        eventDate: ev.event_date,
        userId: ev.user_id,
        signature: r.signature,
        latitude: lat,
        longitude: lng,
        cellId: r.cell_id,
        resolvedAddress: r.resolved_address,
      });
    }
  }

  console.log("─".repeat(72));
  console.log(" Planned updates");
  console.log("─".repeat(72));
  console.log(`  ✓ Apply: ${planned.length} events`);
  console.log(`  ⚠ Stale (cell_id populated since audit): ${staleRows.length}`);
  console.log("");

  if (planned.length > 0) {
    // Summary per signature so the output stays readable.
    const bySignature = new Map<
      string,
      { count: number; sample: Op }
    >();
    for (const op of planned) {
      const existing = bySignature.get(op.signature);
      if (existing) {
        existing.count += 1;
      } else {
        bySignature.set(op.signature, { count: 1, sample: op });
      }
    }
    for (const [sig, info] of bySignature) {
      console.log(`  ▸ ${sig}`);
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
  for (const op of planned) {
    const { error } = await supabase
      .from("events")
      .update({
        latitude: op.latitude,
        longitude: op.longitude,
        cell_id: op.cellId,
      })
      .eq("id", op.eventId);
    if (error) {
      console.log(`  ✗ ${op.eventId} update failed: ${error.message}`);
      failed++;
      continue;
    }
    updated++;
  }
  console.log("");
  console.log(`Updated ${updated} events. Failed: ${failed}.`);
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
