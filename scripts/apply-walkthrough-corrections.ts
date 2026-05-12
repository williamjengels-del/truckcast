#!/usr/bin/env node
// Apply operator-entered net_sales corrections from the audit
// walkthrough TSV. Reads the `corrected_value` column the operator
// filled in and writes the new net_sales to the matching event row,
// flipping pos_source to "manual" so the row is protected from
// future POS-sync overwrites.
//
// Pattern matches scripts/apply-triage.mjs / apply-merge-candidates.mjs:
// default DRY-RUN; `--apply` is required to write. Stale-row check
// re-reads each event by id before writing and aborts the row if the
// DB state has drifted from what's on the TSV (operator edited it via
// UI mid-walk, etc.).
//
// Per feedback_no_auto_fix_data: this script is a confirmed-by-operator
// apply tool. The operator has filled in corrected values in the TSV;
// this script restates each change before applying.
//
// Usage:
//   Dry-run (default):
//     npx tsx --env-file=.env.local scripts/apply-walkthrough-corrections.ts \
//       --tsv overwritten-audit-walkthrough.tsv
//
//   Apply (after reviewing dry-run output):
//     npx tsx --env-file=.env.local scripts/apply-walkthrough-corrections.ts \
//       --tsv overwritten-audit-walkthrough.tsv --apply

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--apply") args.set("apply", "true");
  else if (a.startsWith("--")) args.set(a.slice(2), process.argv[++i] ?? "");
}
const tsvPath = args.get("tsv");
if (!tsvPath) {
  console.error("Usage: --tsv <path> [--apply]");
  process.exit(2);
}
const APPLY = args.get("apply") === "true";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function parseTsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

function parseNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const rows = parseTsv(readFileSync(tsvPath, "utf8"));
  const todo: Array<{
    event_id: string;
    event_date: string;
    event_name: string;
    current_value: number | null;
    new_value: number;
    notes: string;
  }> = [];
  const skipped: Array<{ row: number; reason: string; event_name: string }> = [];

  rows.forEach((r, idx) => {
    const correctedRaw = (r.corrected_value ?? "").trim();
    if (!correctedRaw) return;
    const newValue = parseNumber(correctedRaw);
    if (newValue === null) {
      skipped.push({
        row: idx + 2,
        reason: `corrected_value "${correctedRaw}" not parseable as number`,
        event_name: r.event_name,
      });
      return;
    }
    if (newValue < 0) {
      skipped.push({
        row: idx + 2,
        reason: `corrected_value ${newValue} is negative`,
        event_name: r.event_name,
      });
      return;
    }
    if (!r.event_id) {
      skipped.push({
        row: idx + 2,
        reason: `no event_id`,
        event_name: r.event_name,
      });
      return;
    }
    const current = parseNumber(r.current_net_sales);
    todo.push({
      event_id: r.event_id,
      event_date: r.event_date,
      event_name: r.event_name,
      current_value: current,
      new_value: newValue,
      notes: r.notes ?? "",
    });
  });

  // Detect potential column misalignment: operator's TSV edit may have
  // landed notes/values in the wrong column (e.g. corrected_value blank
  // but a numeric value in `done`, or a long string in `done` that
  // looks like a note). Surface these as warnings — don't auto-fix.
  const misaligned: Array<{ row: number; event_name: string; reason: string }> = [];
  rows.forEach((r, idx) => {
    const correctedRaw = (r.corrected_value ?? "").trim();
    const doneRaw = (r.done ?? "").trim();
    const notesRaw = (r.notes ?? "").trim();
    // Numeric value in `done` while corrected_value is empty
    if (!correctedRaw && doneRaw && parseNumber(doneRaw) !== null) {
      misaligned.push({
        row: idx + 2,
        event_name: r.event_name,
        reason: `\`done\` column has numeric value "${doneRaw}" but corrected_value is empty — likely meant for corrected_value`,
      });
    }
    // Long text in `done` while notes is empty
    if (doneRaw.length > 5 && parseNumber(doneRaw) === null && !notesRaw) {
      misaligned.push({
        row: idx + 2,
        event_name: r.event_name,
        reason: `\`done\` has text "${doneRaw.slice(0, 60)}${doneRaw.length > 60 ? "..." : ""}" — likely meant for notes`,
      });
    }
  });

  console.log(`\n=== WALKTHROUGH CORRECTIONS PLAN ===`);
  console.log(`Mode: ${APPLY ? "🔴 APPLY (writing to DB)" : "🟢 DRY-RUN (no writes)"}`);
  console.log(`TSV: ${tsvPath}`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Rows with corrected_value to apply: ${todo.length}`);
  console.log(`Skipped (invalid corrected_value): ${skipped.length}`);
  console.log(``);

  if (misaligned.length > 0) {
    console.log(`--- ⚠️  POSSIBLE COLUMN MISALIGNMENT (review before --apply) ---`);
    for (const m of misaligned) {
      console.log(`  Row ${m.row} "${m.event_name}": ${m.reason}`);
    }
    console.log(``);
  }

  if (skipped.length > 0) {
    console.log(`--- SKIPPED ROWS ---`);
    for (const s of skipped) {
      console.log(`  Row ${s.row} "${s.event_name}": ${s.reason}`);
    }
    console.log(``);
  }

  console.log(`--- CHANGES TO APPLY ---`);
  for (const t of todo) {
    const curStr = t.current_value === null ? "(empty)" : `$${t.current_value}`;
    const delta = t.current_value !== null ? t.new_value - t.current_value : null;
    const deltaStr = delta !== null ? ` (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)})` : "";
    console.log(
      `  ${t.event_date}  "${t.event_name}"  ${curStr} → $${t.new_value.toFixed(2)}${deltaStr}  [id=${t.event_id.slice(0, 8)}]`
    );
    if (t.notes) console.log(`      notes: ${t.notes}`);
  }
  console.log(``);

  if (!APPLY) {
    console.log(`🟢 DRY-RUN complete. Review the plan above.`);
    console.log(`   To execute: rerun with --apply`);
    console.log(`   Each change also sets pos_source = "manual" so the row`);
    console.log(`   is protected from future POS-sync overwrites.`);
    process.exit(0);
  }

  // Apply mode — write to DB
  console.log(`🔴 APPLY mode — writing changes to production Supabase...\n`);
  let applied = 0;
  let staleSkipped = 0;
  let errored = 0;
  const errors: string[] = [];

  for (const t of todo) {
    // Stale-row check: re-read net_sales + pos_source to verify the
    // operator hasn't already edited this row via UI mid-walk
    const { data: current, error: readErr } = await supabase
      .from("events")
      .select("net_sales, pos_source")
      .eq("id", t.event_id)
      .single();
    if (readErr || !current) {
      errored++;
      errors.push(`${t.event_id} (${t.event_name}): read failed — ${readErr?.message ?? "no row"}`);
      continue;
    }
    const dbCur = current.net_sales == null ? null : Number(current.net_sales);
    // If current DB value already equals the corrected value, skip (idempotent)
    if (dbCur !== null && Math.abs(dbCur - t.new_value) < 0.005) {
      staleSkipped++;
      console.log(`  ✓ ${t.event_date} "${t.event_name}" already at $${t.new_value} — skip`);
      continue;
    }
    // If DB current doesn't match the TSV's current_value, operator may
    // have already touched this row. Skip with a warning.
    if (t.current_value !== null && dbCur !== null && Math.abs(dbCur - t.current_value) > 0.005) {
      staleSkipped++;
      console.log(
        `  ⚠ ${t.event_date} "${t.event_name}" DB current ($${dbCur}) drifted from TSV current ($${t.current_value}) — skip to avoid overwriting operator's mid-walk edit`
      );
      continue;
    }
    const { error: writeErr } = await supabase
      .from("events")
      .update({ net_sales: t.new_value, pos_source: "manual" })
      .eq("id", t.event_id);
    if (writeErr) {
      errored++;
      errors.push(`${t.event_id} (${t.event_name}): write failed — ${writeErr.message}`);
      continue;
    }
    applied++;
    console.log(`  ✓ ${t.event_date} "${t.event_name}" $${dbCur ?? "—"} → $${t.new_value}`);
  }

  console.log(``);
  console.log(`Applied: ${applied}`);
  console.log(`Skipped (stale or idempotent): ${staleSkipped}`);
  console.log(`Errored: ${errored}`);
  if (errors.length > 0) {
    console.log(`\n--- ERRORS ---`);
    for (const e of errors) console.log(`  ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
