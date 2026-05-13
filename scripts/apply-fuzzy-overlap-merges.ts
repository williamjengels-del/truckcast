#!/usr/bin/env node
// Apply operator-reviewed alias merges from the fuzzy-overlap TSV.
//
// Reads a TSV produced by scripts/export-fuzzy-overlap-tsv.ts and
// marked by the operator. For each row whose `operator_decision`
// indicates a merge, writes the corresponding event_name_aliases entry
// so future recalcs aggregate both name variants into one canonical
// bucket. Triggers updatePlatformRegistry on each touched canonical so
// the registry refreshes immediately.
//
// Decision matching (case-insensitive):
//   • "agreed", "agreed on canon", "merge"   → apply merge
//   • "no", "distinct", "separate", "skip"    → skip explicitly
//   • blank or "needs-review", "unsure"       → log for operator follow-up
//
// Canonical resolution per row:
//   • If `operator_canon` is set, use it
//   • Else fall back to `suggested_canon`
//   • One of name_a / name_b should match the canonical; the OTHER
//     becomes the alias. If neither matches, treat both as aliases of
//     the chosen canonical string.
//
// Chain prevention mirrors src/app/api/admin/event-aliases/route.ts —
// reject mappings that would create alias→alias→canonical chains.
//
// Read-only of operator data. Writes only to event_name_aliases
// (system table) and triggers updatePlatformRegistry (re-derivation
// from operator data). Idempotent — re-running with the same TSV is
// safe; existing aliases short-circuit.
//
// Default dry-run; --apply required to write.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/apply-fuzzy-overlap-merges.ts <path-to-tsv> [--apply]

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { updatePlatformRegistry } from "../src/lib/platform-registry";

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
if (!tsvPath) {
  console.error(
    "Usage: apply-fuzzy-overlap-merges.ts <path-to-tsv> [--apply]"
  );
  process.exit(2);
}

interface TsvRow {
  name_a: string;
  name_b: string;
  match_type: string;
  best_score: string;
  suggested_canon: string;
  operator_decision: string;
  operator_canon: string;
  notes: string;
}

function parseTsv(path: string): TsvRow[] {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  const idx = (col: string) => header.indexOf(col);
  const colNameA = idx("name_a");
  const colNameB = idx("name_b");
  const colMatch = idx("match_type");
  const colScore = idx("best_score");
  const colSuggest = idx("suggested_canon");
  const colDecision = idx("operator_decision");
  const colCanon = idx("operator_canon");
  const colNotes = idx("notes");
  const required = [colNameA, colNameB, colDecision, colSuggest];
  if (required.some((i) => i < 0)) {
    console.error(
      "TSV is missing one of: name_a, name_b, operator_decision, suggested_canon"
    );
    process.exit(2);
  }
  const out: TsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    out.push({
      name_a: cells[colNameA] ?? "",
      name_b: cells[colNameB] ?? "",
      match_type: cells[colMatch] ?? "",
      best_score: cells[colScore] ?? "",
      suggested_canon: cells[colSuggest] ?? "",
      operator_decision: cells[colDecision] ?? "",
      operator_canon: cells[colCanon] ?? "",
      notes: cells[colNotes] ?? "",
    });
  }
  return out;
}

function classifyDecision(
  decision: string
): "merge" | "skip" | "review" {
  const d = decision.trim().toLowerCase();
  if (!d) return "review";
  if (d.includes("agreed") || d === "merge" || d.startsWith("yes"))
    return "merge";
  if (d === "no" || d.includes("distinct") || d.includes("separate") || d === "skip")
    return "skip";
  return "review";
}

interface AliasOp {
  aliasDisplay: string;
  canonicalDisplay: string;
  notes: string | null;
}

function looksLikeProseNote(s: string): boolean {
  // Heuristic: operator_canon values that smell like prose, not an
  // event name. Notes accidentally placed in the canon column tend to
  // be long, comma-separated, or contain "should/would/recheck/etc."
  if (s.length > 80) return true;
  if (/[,;]\s/.test(s)) return true;
  if (/\b(should|would|recheck|operator|location is|technically)\b/i.test(s))
    return true;
  if (/^DATA_FIX:/i.test(s)) return true;
  return false;
}

function pickCanonical(row: TsvRow): {
  canon: string;
  warning: string | null;
} {
  const opCanon = row.operator_canon.trim();
  // Trust operator_canon if it looks like an event name (not prose).
  // It can validly be name_a, name_b, OR a third string (the operator
  // can elect a previously-established canonical from another row).
  if (opCanon && !looksLikeProseNote(opCanon)) {
    return { canon: opCanon, warning: null };
  }
  if (opCanon && looksLikeProseNote(opCanon)) {
    const preview =
      opCanon.length > 60 ? opCanon.slice(0, 60) + "…" : opCanon;
    return {
      canon: row.suggested_canon.trim(),
      warning: `operator_canon "${preview}" looks like a note, not a name — falling back to suggested_canon`,
    };
  }
  return { canon: row.suggested_canon.trim(), warning: null };
}

function planMerge(row: TsvRow): {
  ops: AliasOp[];
  warning: string | null;
} {
  const { canon, warning } = pickCanonical(row);
  if (!canon) return { ops: [], warning };
  const canonNorm = canon.toLowerCase();
  const ops: AliasOp[] = [];
  for (const candidate of [row.name_a, row.name_b]) {
    if (!candidate.trim()) continue;
    if (candidate.toLowerCase() === canonNorm) continue;
    ops.push({
      aliasDisplay: candidate,
      canonicalDisplay: canon,
      notes: row.notes.trim() || null,
    });
  }
  return { ops, warning };
}

interface ExistingAliasRow {
  alias_normalized: string;
  canonical_normalized: string;
}

async function loadExistingAliases(): Promise<ExistingAliasRow[]> {
  const { data, error } = await supabase
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized");
  if (error) {
    console.error("event_name_aliases fetch failed:", error.message);
    process.exit(1);
  }
  return (data ?? []) as ExistingAliasRow[];
}

function chainConflict(
  op: AliasOp,
  existing: ExistingAliasRow[]
): string | null {
  const aliasNorm = op.aliasDisplay.toLowerCase();
  const canonNorm = op.canonicalDisplay.toLowerCase();
  if (aliasNorm === canonNorm) {
    return "alias and canonical normalize to the same string";
  }
  for (const row of existing) {
    if (row.alias_normalized === aliasNorm) {
      // Already aliased — check if the canonical matches; if so, idempotent skip
      if (row.canonical_normalized === canonNorm) {
        return "ALREADY_APPLIED";
      }
      return `alias "${op.aliasDisplay}" already maps to "${row.canonical_normalized}" — conflict, manual review`;
    }
    if (row.canonical_normalized === aliasNorm) {
      return `"${op.aliasDisplay}" is itself an existing canonical (would create chain)`;
    }
    if (row.alias_normalized === canonNorm) {
      return `canonical "${op.canonicalDisplay}" is an existing alias for "${row.canonical_normalized}" — pick deeper canonical or remove first`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const rows = parseTsv(tsvPath);
  console.log("=".repeat(72));
  console.log(` Apply fuzzy-overlap alias merges from ${tsvPath}`);
  console.log("=".repeat(72));
  console.log("");
  console.log(`Parsed ${rows.length} rows from TSV.`);

  const merges: TsvRow[] = [];
  const skips: TsvRow[] = [];
  const reviews: TsvRow[] = [];
  for (const r of rows) {
    const c = classifyDecision(r.operator_decision);
    if (c === "merge") merges.push(r);
    else if (c === "skip") skips.push(r);
    else reviews.push(r);
  }
  console.log(`  • Merge: ${merges.length}`);
  console.log(`  • Skip (distinct): ${skips.length}`);
  console.log(`  • Needs review (blank / unsure): ${reviews.length}`);
  console.log("");

  // Existing aliases for chain prevention + idempotent re-runs.
  const existing = await loadExistingAliases();
  console.log(`Existing event_name_aliases rows: ${existing.length}`);
  console.log("");

  // Plan
  console.log("─".repeat(72));
  console.log(" Planned operations");
  console.log("─".repeat(72));
  const planned: AliasOp[] = [];
  const conflicted: { op: AliasOp; reason: string }[] = [];
  const alreadyApplied: AliasOp[] = [];
  const warnings: { row: TsvRow; warning: string }[] = [];
  // Within-batch dedup. Multiple rows can plan the same alias→canon
  // mapping (e.g., the Light the Night family appears in two rows
  // that both resolve to the same canonical). The DB unique
  // constraint on alias_normalized would reject the duplicate insert;
  // dedup here so the conflict report stays clean.
  const batchSeen = new Set<string>();
  for (const r of merges) {
    const { ops, warning } = planMerge(r);
    if (warning) warnings.push({ row: r, warning });
    if (ops.length === 0) {
      console.log(`  ⚠ No canonical resolved for: ${r.name_a} ↔ ${r.name_b} — skipping`);
      continue;
    }
    for (const op of ops) {
      const aliasNorm = op.aliasDisplay.toLowerCase();
      const canonNorm = op.canonicalDisplay.toLowerCase();
      const key = `${aliasNorm}${canonNorm}`;
      if (batchSeen.has(key)) continue;
      batchSeen.add(key);
      const conflict = chainConflict(op, existing);
      if (conflict === "ALREADY_APPLIED") {
        alreadyApplied.push(op);
      } else if (conflict) {
        conflicted.push({ op, reason: conflict });
      } else {
        planned.push(op);
      }
    }
  }

  console.log(`  ✓ Apply: ${planned.length}`);
  for (const op of planned) {
    console.log(`      "${op.aliasDisplay}" → "${op.canonicalDisplay}"`);
  }
  console.log(`  = Already applied (no-op): ${alreadyApplied.length}`);
  for (const op of alreadyApplied) {
    console.log(`      "${op.aliasDisplay}" → "${op.canonicalDisplay}"`);
  }
  if (conflicted.length > 0) {
    console.log(`  ✗ Conflicted (manual review): ${conflicted.length}`);
    for (const { op, reason } of conflicted) {
      console.log(`      "${op.aliasDisplay}" → "${op.canonicalDisplay}"`);
      console.log(`        reason: ${reason}`);
    }
  }
  console.log("");

  if (warnings.length > 0) {
    console.log("─".repeat(72));
    console.log(" Column-placement warnings (operator_canon misplaced)");
    console.log(" These rows still applied via suggested_canon fallback.");
    console.log("─".repeat(72));
    for (const { row, warning } of warnings) {
      console.log(`  ⚠ "${row.name_a}" ↔ "${row.name_b}"`);
      console.log(`    ${warning}`);
    }
    console.log("");
  }

  // Needs-review rows for operator follow-up
  if (reviews.length > 0) {
    console.log("─".repeat(72));
    console.log(" Rows needing operator follow-up (blank or unsure)");
    console.log("─".repeat(72));
    for (const r of reviews) {
      console.log(`  ? "${r.name_a}" ↔ "${r.name_b}"`);
      if (r.notes.trim()) console.log(`    notes: ${r.notes.trim()}`);
    }
    console.log("");
  }

  // Data-correction notes — surface for operator awareness
  const dataCorrections = merges
    .concat(skips, reviews)
    .filter((r) => {
      const n = r.notes.toLowerCase();
      return (
        n.includes("city should") ||
        n.includes("city is") ||
        n.includes("recheck") ||
        n.includes("not be") ||
        (n.includes("location is") && n.includes("technically"))
      );
    });
  if (dataCorrections.length > 0) {
    console.log("─".repeat(72));
    console.log(" Data-correction notes flagged in operator review");
    console.log(" (not handled by alias merge — surfaced for separate cleanup)");
    console.log("─".repeat(72));
    for (const r of dataCorrections) {
      console.log(`  • "${r.name_a}" / "${r.name_b}"`);
      console.log(`    ${r.notes.trim()}`);
    }
    console.log("");
  }

  if (!applyFlag) {
    console.log("Dry-run complete. Re-run with --apply to write event_name_aliases rows.");
    return;
  }

  if (planned.length === 0) {
    console.log("Nothing to apply. Exiting.");
    return;
  }

  console.log("─".repeat(72));
  console.log(" Applying…");
  console.log("─".repeat(72));
  const touchedCanonicals = new Set<string>();
  let inserted = 0;
  for (const op of planned) {
    const aliasNorm = op.aliasDisplay.toLowerCase();
    const canonNorm = op.canonicalDisplay.toLowerCase();
    const { error } = await supabase.from("event_name_aliases").insert({
      alias_normalized: aliasNorm,
      canonical_normalized: canonNorm,
      alias_display: op.aliasDisplay,
      canonical_display: op.canonicalDisplay,
      created_by: null, // script-applied; no human admin id
      notes: op.notes ?? "applied via apply-fuzzy-overlap-merges.ts",
    });
    if (error) {
      console.log(`  ✗ insert failed for "${op.aliasDisplay}": ${error.message}`);
      continue;
    }
    inserted++;
    touchedCanonicals.add(op.canonicalDisplay);
    console.log(`  ✓ "${op.aliasDisplay}" → "${op.canonicalDisplay}"`);
  }
  console.log("");
  console.log(`Inserted ${inserted} of ${planned.length} planned aliases.`);

  // Recompute platform_events for every touched canonical so the
  // aggregate refreshes immediately (alias-form events fold in).
  if (touchedCanonicals.size > 0) {
    console.log("");
    console.log(`Recomputing platform_events for ${touchedCanonicals.size} canonical(s)…`);
    try {
      await updatePlatformRegistry(Array.from(touchedCanonicals));
      console.log("  ✓ done");
    } catch (e) {
      console.log(`  ✗ recompute failed: ${e}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
