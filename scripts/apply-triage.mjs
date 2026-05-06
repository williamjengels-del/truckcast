#!/usr/bin/env node
// Apply operator-reviewed triage decisions to the events table.
//
// Reads a TSV produced by scripts/audit-triage.mjs after the operator
// has filled column 11 (action_decision) with one of:
//   keep / it_is_fine    → no-op, skip
//   delete               → DELETE the row by id
//   fix-date:YYYY-MM-DD  → UPDATE event_date to the new date
//   (blank)              → no decision yet, skip
//
// Default mode is DRY-RUN — prints exactly what would change without
// touching the database. Pass --apply to execute. Always cross-checks
// row id + name + date against current DB state before acting (defends
// against running a stale TSV against a moved-on database).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/apply-triage.mjs <path-to-reviewed-tsv> [--apply]
//
// Safe to run dry-run anytime. --apply requires the env vars + an
// explicit greenlight from the operator (this script doesn't prompt).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const tsvPath = argv.find((a) => !a.startsWith("--"));
const isApply = argv.includes("--apply");

if (!tsvPath) {
  console.error(
    "Usage: node scripts/apply-triage.mjs <path-to-reviewed-tsv> [--apply]"
  );
  console.error("");
  console.error(
    "Default is DRY-RUN. Pass --apply to actually write changes."
  );
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and " +
      "SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─────────────────────────────────────────────────────────────────
// TSV parsing
// ─────────────────────────────────────────────────────────────────

const raw = readFileSync(tsvPath, "utf8");
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
if (lines.length < 2) {
  console.error("TSV has no data rows");
  process.exit(2);
}

const header = lines[0].split("\t");
const idIdx = header.indexOf("id");
const dateIdx = header.indexOf("event_date");
const nameIdx = header.indexOf("event_name");
const actionIdx = header.indexOf("action_decision");

if (idIdx < 0 || dateIdx < 0 || nameIdx < 0 || actionIdx < 0) {
  console.error(
    `TSV missing required columns. Need: id, event_date, event_name, action_decision. Got: ${header.join(", ")}`
  );
  process.exit(2);
}

// Excel saves dates back as MM/DD/YYYY when the file is opened and
// re-saved. Normalize to ISO YYYY-MM-DD for DB comparison + the
// fix-date target value.
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

const operations = []; // { kind, id, name_in_tsv, date_in_tsv, target_date? }

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split("\t");
  const id = cols[idIdx]?.trim();
  const dateInTsv = normalizeDate(cols[dateIdx]);
  const nameInTsv = cols[nameIdx]?.trim();
  const action = (cols[actionIdx] ?? "").trim();

  if (!id || !action) continue;

  if (action === "keep" || action === "it_is_fine") {
    continue; // no-op
  }
  if (action === "delete") {
    operations.push({ kind: "delete", id, nameInTsv, dateInTsv });
    continue;
  }
  if (action.startsWith("fix-date:")) {
    const target = normalizeDate(action.slice("fix-date:".length).trim());
    if (!target) {
      console.error(
        `Row ${i}: invalid fix-date format "${action}". Expected fix-date:YYYY-MM-DD. Skipping.`
      );
      continue;
    }
    operations.push({ kind: "fix-date", id, nameInTsv, dateInTsv, target });
    continue;
  }
  console.error(
    `Row ${i}: unknown action_decision "${action}". Skipping. (Valid: keep / delete / fix-date:YYYY-MM-DD / it_is_fine / blank)`
  );
}

if (operations.length === 0) {
  console.error("No actionable rows found in the TSV.");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────
// Cross-check current DB state for each operation. Defends against
// stale TSV (rows already deleted, names changed, dates moved).
// ─────────────────────────────────────────────────────────────────

const ids = operations.map((o) => o.id);

const { data: currentRows, error } = await supabase
  .from("events")
  .select("id, event_date, event_name, user_id")
  .in("id", ids);

if (error) {
  console.error(`DB query failed: ${error.message}`);
  process.exit(2);
}

const currentById = new Map((currentRows ?? []).map((r) => [r.id, r]));

// Categorize operations.
const ready = [];
const stale = []; // current state doesn't match TSV
const missing = []; // id not found in DB
for (const op of operations) {
  const current = currentById.get(op.id);
  if (!current) {
    missing.push(op);
    continue;
  }
  const nameMatches = (current.event_name ?? "").trim() === (op.nameInTsv ?? "").trim();
  const dateMatches = current.event_date === op.dateInTsv;
  if (!nameMatches || !dateMatches) {
    stale.push({
      ...op,
      current_name: current.event_name,
      current_date: current.event_date,
    });
    continue;
  }
  ready.push({ ...op, user_id: current.user_id });
}

// ─────────────────────────────────────────────────────────────────
// Print plan
// ─────────────────────────────────────────────────────────────────

const deletes = ready.filter((o) => o.kind === "delete");
const fixDates = ready.filter((o) => o.kind === "fix-date");

console.error("");
console.error(`# Triage TSV: ${tsvPath}`);
console.error(`# Mode: ${isApply ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);
console.error("");
console.error(`# Plan:`);
console.error(`#   Deletes:    ${deletes.length}`);
console.error(`#   Date fixes: ${fixDates.length}`);
if (stale.length > 0) console.error(`#   STALE:      ${stale.length} (TSV name/date don't match current DB; skipping for safety)`);
if (missing.length > 0) console.error(`#   MISSING:    ${missing.length} (row id not in DB; possibly already deleted)`);
console.error("");

if (stale.length > 0) {
  console.error(`# Stale rows (skipped — re-run audit-triage.mjs to refresh):`);
  for (const op of stale.slice(0, 10)) {
    console.error(`#   id=${op.id.slice(0, 8)} TSV: "${op.nameInTsv}" @ ${op.dateInTsv} — DB: "${op.current_name}" @ ${op.current_date}`);
  }
  if (stale.length > 10) console.error(`#   ... ${stale.length - 10} more`);
  console.error("");
}

if (missing.length > 0) {
  console.error(`# Missing rows (skipped — already deleted, or id changed):`);
  for (const op of missing.slice(0, 10)) {
    console.error(`#   id=${op.id.slice(0, 8)} "${op.nameInTsv}" @ ${op.dateInTsv}`);
  }
  if (missing.length > 10) console.error(`#   ... ${missing.length - 10} more`);
  console.error("");
}

if (deletes.length > 0) {
  console.error(`# Deletes (first 10):`);
  for (const op of deletes.slice(0, 10)) {
    console.error(`#   "${op.nameInTsv}" @ ${op.dateInTsv} (id=${op.id.slice(0, 8)})`);
  }
  if (deletes.length > 10) console.error(`#   ... ${deletes.length - 10} more`);
  console.error("");
}

if (fixDates.length > 0) {
  console.error(`# Date fixes:`);
  for (const op of fixDates) {
    console.error(`#   "${op.nameInTsv}" ${op.dateInTsv} → ${op.target}`);
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
let dateFixCount = 0;
const errors = [];

for (const op of deletes) {
  const { error: delErr } = await supabase
    .from("events")
    .delete()
    .eq("id", op.id);
  if (delErr) {
    errors.push(`delete ${op.id.slice(0, 8)} (${op.nameInTsv}): ${delErr.message}`);
  } else {
    deletedCount++;
  }
}

for (const op of fixDates) {
  const { error: updErr } = await supabase
    .from("events")
    .update({ event_date: op.target })
    .eq("id", op.id);
  if (updErr) {
    errors.push(`fix-date ${op.id.slice(0, 8)} (${op.nameInTsv}): ${updErr.message}`);
  } else {
    dateFixCount++;
  }
}

console.error("");
console.error(`# Done.`);
console.error(`#   Deleted:    ${deletedCount}/${deletes.length}`);
console.error(`#   Date fixes: ${dateFixCount}/${fixDates.length}`);
if (errors.length > 0) {
  console.error(`#   ERRORS:     ${errors.length}`);
  for (const e of errors) console.error(`#     ${e}`);
  process.exit(1);
}

// Recommend a recalculation pass after deletes since event_performance
// aggregates derive from the events table.
if (deletedCount > 0 || dateFixCount > 0) {
  console.error("");
  console.error(
    "# Recommend running the operator's /api/recalculate (Insights tab → Refresh) so"
  );
  console.error(
    "# event_performance + forecasts pick up the cleaned data."
  );
}
