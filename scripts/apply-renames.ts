#!/usr/bin/env node
// Apply operator-confirmed event_name renames from a candidate TSV
// produced by scripts/find-rename-candidates.ts. Default DRY-RUN;
// --apply required to write.
//
// Operator fills column 8 (`decision`) of the candidate TSV with one
// of: `apply` (rename row to suggested_canonical), `keep` (leave),
// blank (defer). This script only acts on rows with decision=apply.
//
// Per feedback_no_auto_fix_data: TSV-and-confirm; restates each
// rename before writing.
//
// Usage:
//   Dry-run:
//     npx tsx --env-file=.env.local scripts/apply-renames.ts \
//       --tsv rename-candidates-2026-05-12.tsv
//   Apply:
//     npx tsx --env-file=.env.local scripts/apply-renames.ts \
//       --tsv rename-candidates-2026-05-12.tsv --apply

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
  console.error("Missing env vars.");
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

async function main() {
  const rows = parseTsv(readFileSync(tsvPath, "utf8"));
  const todo: Array<{
    event_id: string;
    event_date: string;
    current_name: string;
    canonical: string;
    rationale: string;
  }> = [];

  for (const r of rows) {
    const decision = (r.decision ?? "").trim().toLowerCase();
    if (decision !== "apply") continue;
    if (!r.event_id || !r.suggested_canonical) continue;
    if (r.current_name === r.suggested_canonical) continue;
    todo.push({
      event_id: r.event_id,
      event_date: r.event_date,
      current_name: r.current_name,
      canonical: r.suggested_canonical,
      rationale: r.rationale ?? "",
    });
  }

  console.log(`\n=== RENAME PLAN ===`);
  console.log(`Mode: ${APPLY ? "🔴 APPLY (writing to DB)" : "🟢 DRY-RUN (no writes)"}`);
  console.log(`TSV: ${tsvPath}`);
  console.log(`Rows in TSV: ${rows.length}`);
  console.log(`Rows with decision=apply: ${todo.length}`);
  console.log(``);

  if (todo.length === 0) {
    console.log(`No rows marked decision=apply. Operator should fill column 8 of the TSV.`);
    process.exit(0);
  }

  console.log(`--- RENAMES TO APPLY ---`);
  for (const t of todo) {
    console.log(`  ${t.event_date}  "${t.current_name}" → "${t.canonical}"  [id=${t.event_id.slice(0, 8)}]`);
    console.log(`      ${t.rationale}`);
  }
  console.log(``);

  if (!APPLY) {
    console.log(`🟢 DRY-RUN complete. To execute, rerun with --apply.`);
    process.exit(0);
  }

  console.log(`🔴 APPLY mode — writing to production Supabase...\n`);
  let applied = 0;
  let staleSkipped = 0;
  let errored = 0;
  const errors: string[] = [];

  for (const t of todo) {
    // Stale-row check
    const { data: current, error: readErr } = await supabase
      .from("events")
      .select("event_name")
      .eq("id", t.event_id)
      .single();
    if (readErr || !current) {
      errored++;
      errors.push(`${t.event_id}: read failed — ${readErr?.message ?? "no row"}`);
      continue;
    }
    if (current.event_name === t.canonical) {
      staleSkipped++;
      console.log(`  ✓ "${t.current_name}" already at canonical — skip`);
      continue;
    }
    if (current.event_name !== t.current_name) {
      staleSkipped++;
      console.log(
        `  ⚠ ${t.event_date} DB current "${current.event_name}" drifted from TSV "${t.current_name}" — skip`
      );
      continue;
    }
    // Also flip pos_source to "manual" alongside the rename. Operator
    // renaming the row is them claiming it as canonical — their sales
    // values shouldn't be re-overwritten by a future POS sync, even if
    // the value wasn't touched here. Without this flip, the row gets
    // re-flagged in subsequent audit runs as pos_source != "manual"
    // with existing sales (LOW_POS_PAST). 2026-05-12 gap-closure.
    const { error: writeErr } = await supabase
      .from("events")
      .update({ event_name: t.canonical, pos_source: "manual" })
      .eq("id", t.event_id);
    if (writeErr) {
      errored++;
      errors.push(`${t.event_id}: write failed — ${writeErr.message}`);
      continue;
    }
    applied++;
    console.log(`  ✓ ${t.event_date} "${t.current_name}" → "${t.canonical}"`);
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
