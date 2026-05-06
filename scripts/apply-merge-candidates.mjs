#!/usr/bin/env node
// Apply operator-reviewed merge decisions to the events table.
//
// Reads a TSV produced by scripts/find-merge-candidates.mjs after the
// operator has filled column 13 (merge_decision) with one of:
//   keep_a            → DELETE id_b, id_a stays
//   keep_b            → DELETE id_a, id_b stays
//   keep_both         → no-op, both rows stay (treated as not-a-dupe)
//   not_dupe          → no-op (alias for keep_both)
//   (blank)           → no decision yet, skip
//
// Default mode is DRY-RUN — prints what would change without writing.
// Pass --apply to execute. Cross-checks each row id + name + date
// against current DB state before deleting (defends against running a
// stale TSV against a moved-on database).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/apply-merge-candidates.mjs <path-to-reviewed-tsv> [--apply]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const tsvPath = argv.find((a) => !a.startsWith("--"));
const isApply = argv.includes("--apply");

if (!tsvPath) {
  console.error(
    "Usage: node scripts/apply-merge-candidates.mjs <path-to-reviewed-tsv> [--apply]"
  );
  console.error("Default is DRY-RUN. Pass --apply to actually write changes.");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─────────────────────────────────────────────────────────────────
// Parse TSV
// ─────────────────────────────────────────────────────────────────

const raw = readFileSync(tsvPath, "utf8");
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
if (lines.length < 2) {
  console.error("TSV has no data rows");
  process.exit(2);
}

const header = lines[0].split("\t");
const dateIdx = header.indexOf("event_date");
const nameAIdx = header.indexOf("name_a");
const nameBIdx = header.indexOf("name_b");
const idAIdx = header.indexOf("id_a");
const idBIdx = header.indexOf("id_b");
const decisionIdx = header.indexOf("merge_decision");

if ([dateIdx, nameAIdx, nameBIdx, idAIdx, idBIdx, decisionIdx].some((i) => i < 0)) {
  console.error(
    `TSV missing required columns. Need: event_date, name_a, name_b, id_a, id_b, merge_decision. Got: ${header.join(", ")}`
  );
  process.exit(2);
}

function normalizeDate(s) {
  if (!s) return null;
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

// Each operation is a planned delete: { id, name, date, paired_with }.
const deletePlan = [];
const noopPlan = []; // keep_both / not_dupe — recorded for the report only

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split("\t");
  const decision = (cols[decisionIdx] ?? "").trim();
  const date = normalizeDate(cols[dateIdx]);
  const nameA = cols[nameAIdx]?.trim();
  const nameB = cols[nameBIdx]?.trim();
  const idA = cols[idAIdx]?.trim();
  const idB = cols[idBIdx]?.trim();

  if (!decision || !idA || !idB) continue;

  if (decision === "keep_both" || decision === "not_dupe") {
    noopPlan.push({ date, nameA, nameB, decision });
    continue;
  }
  if (decision === "keep_a") {
    // Delete id_b
    deletePlan.push({
      delete_id: idB,
      delete_name: nameB,
      keep_id: idA,
      keep_name: nameA,
      date,
    });
    continue;
  }
  if (decision === "keep_b") {
    // Delete id_a
    deletePlan.push({
      delete_id: idA,
      delete_name: nameA,
      keep_id: idB,
      keep_name: nameB,
      date,
    });
    continue;
  }
  console.error(
    `Row ${i}: unknown merge_decision "${decision}". Skipping. (Valid: keep_a / keep_b / keep_both / not_dupe / blank)`
  );
}

if (deletePlan.length === 0 && noopPlan.length === 0) {
  console.error("No actionable rows in the TSV.");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────
// Cross-check against current DB state
// ─────────────────────────────────────────────────────────────────

const idsToCheck = new Set();
for (const op of deletePlan) {
  idsToCheck.add(op.delete_id);
  idsToCheck.add(op.keep_id);
}

const { data: currentRows, error: fetchErr } = await supabase
  .from("events")
  .select("id, event_date, event_name")
  .in("id", [...idsToCheck]);

if (fetchErr) {
  console.error(`DB query failed: ${fetchErr.message}`);
  process.exit(2);
}

const currentById = new Map((currentRows ?? []).map((r) => [r.id, r]));

const ready = [];
const stale = [];
const missing = [];

for (const op of deletePlan) {
  const target = currentById.get(op.delete_id);
  const keep = currentById.get(op.keep_id);
  if (!target) {
    missing.push({ ...op, reason: "delete_id not in DB" });
    continue;
  }
  if (!keep) {
    missing.push({ ...op, reason: "keep_id not in DB" });
    continue;
  }
  const targetMatches =
    (target.event_name ?? "").trim() === (op.delete_name ?? "").trim() &&
    target.event_date === op.date;
  if (!targetMatches) {
    stale.push({
      ...op,
      current_target_name: target.event_name,
      current_target_date: target.event_date,
    });
    continue;
  }
  ready.push(op);
}

// ─────────────────────────────────────────────────────────────────
// Print plan
// ─────────────────────────────────────────────────────────────────

console.error("");
console.error(`# Merge candidates TSV: ${tsvPath}`);
console.error(`# Mode: ${isApply ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);
console.error("");
console.error(`# Plan:`);
console.error(`#   Deletes:  ${ready.length}`);
console.error(`#   No-ops (keep_both / not_dupe):  ${noopPlan.length}`);
if (stale.length > 0) console.error(`#   STALE:    ${stale.length}`);
if (missing.length > 0) console.error(`#   MISSING:  ${missing.length}`);
console.error("");

if (stale.length > 0) {
  console.error(`# Stale rows (TSV name/date doesn't match current DB — skipping):`);
  for (const op of stale) {
    console.error(
      `#   delete_id=${op.delete_id.slice(0, 8)} TSV: "${op.delete_name}" @ ${op.date} — DB: "${op.current_target_name}" @ ${op.current_target_date}`
    );
  }
  console.error("");
}

if (missing.length > 0) {
  console.error(`# Missing rows (id not in DB — skipping):`);
  for (const op of missing) {
    console.error(
      `#   ${op.reason}: keep "${op.keep_name}" / delete "${op.delete_name}" @ ${op.date}`
    );
  }
  console.error("");
}

if (ready.length > 0) {
  console.error(`# Deletes (kept row → deleted row):`);
  for (const op of ready) {
    const keepLabel = op.keep_name === op.delete_name ? `"${op.keep_name}"` : `"${op.keep_name}" (keep) vs "${op.delete_name}" (delete)`;
    console.error(`#   ${op.date}: ${keepLabel}`);
  }
  console.error("");
}

if (noopPlan.length > 0) {
  console.error(`# No-ops (kept as separate events):`);
  for (const op of noopPlan) {
    console.error(`#   ${op.date}: "${op.nameA}" + "${op.nameB}" (${op.decision})`);
  }
  console.error("");
}

if (!isApply) {
  console.error("# Dry-run only. To apply: re-run with --apply");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────

console.error("# Applying changes...");
let deletedCount = 0;
const errors = [];
for (const op of ready) {
  const { error: delErr } = await supabase
    .from("events")
    .delete()
    .eq("id", op.delete_id);
  if (delErr) {
    errors.push(`delete ${op.delete_id.slice(0, 8)} (${op.delete_name}): ${delErr.message}`);
  } else {
    deletedCount++;
  }
}

console.error("");
console.error(`# Done.`);
console.error(`#   Deleted: ${deletedCount}/${ready.length}`);
if (errors.length > 0) {
  console.error(`#   ERRORS:  ${errors.length}`);
  for (const e of errors) console.error(`#     ${e}`);
  process.exit(1);
}

if (deletedCount > 0) {
  console.error("");
  console.error(
    "# Recommend running the operator's /api/recalculate (Insights → Refresh) so"
  );
  console.error(
    "# event_performance + forecasts pick up the cleaned data."
  );
}
