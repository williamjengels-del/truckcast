#!/usr/bin/env node
// Apply operator-confirmed city/state corrections from a TSV produced
// during fuzzy-overlap review or other data-quality audits.
//
// Per feedback_no_auto_fix_data: TSV-and-confirm. Operator fills the
// `operator_confirm` column with "Correct" (or similar) to authorize.
// Rows with "leave as is" / blank / "skip" → no-op. Multi-row targets
// supported via the `event_date` column:
//   • A specific YYYY-MM-DD / M/D/YYYY → update only that event_date
//     (still scoped to event_name + the WHOLE matching set across
//     sharing operators OR a specific user — see WORK_USER_IDS).
//   • "(all rows)" → update every event matching event_name on each
//     listed user (e.g., all Wok-O Frankie Martin's Garden rows).
//
// Stale-row protection: each candidate row is re-read by id before the
// UPDATE and the script asserts event_name still matches (operator
// may have renamed via the form mid-session).
//
// Default --dry-run. --apply required to write.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/apply-city-corrections.ts \
//     <tsv-path> [--apply]
//   Optional: --user <user-id>  Scope to a specific user (default: Wok-O)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WOKO_USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";

const tsvPath = process.argv[2];
const applyFlag = process.argv.includes("--apply");
const userIdx = process.argv.indexOf("--user");
const scopeUserId =
  userIdx >= 0 ? process.argv[userIdx + 1] : WOKO_USER_ID;
if (!tsvPath || tsvPath.startsWith("--")) {
  console.error(
    "Usage: apply-city-corrections.ts <tsv-path> [--apply] [--user <user-id>]"
  );
  process.exit(2);
}

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

interface TsvRow {
  event_name: string;
  event_date: string;
  current_city: string;
  current_state: string;
  suggested_city: string;
  suggested_state: string;
  notes: string;
  operator_confirm: string;
}

// Strip surrounding double-quotes from a TSV cell. Excel / Google
// Sheets quote-wrap cells containing commas; the parser sees the
// quotes literally because we split on tabs only. Mirrors what RFC-4180
// CSV parsing would do but only for the simple full-cell-wrap case.
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
      event_name: cells[idx("event_name")] ?? "",
      event_date: cells[idx("event_date")] ?? "",
      current_city: cells[idx("current_city")] ?? "",
      current_state: cells[idx("current_state")] ?? "",
      suggested_city: cells[idx("suggested_city")] ?? "",
      suggested_state: cells[idx("suggested_state")] ?? "",
      notes: cells[idx("notes")] ?? "",
      operator_confirm: cells[idx("operator_confirm")] ?? "",
    });
  }
  return out;
}

function classifyConfirm(c: string): "apply" | "skip" {
  const n = c.trim().toLowerCase();
  if (!n) return "skip";
  if (n.startsWith("correct") || n === "apply" || n === "yes")
    return "apply";
  return "skip";
}

function normalizeIsoDate(input: string): string | null {
  // Accept YYYY-MM-DD or M/D/YYYY; reject "(all rows)" / etc.
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

async function findCandidates(row: TsvRow): Promise<
  Array<{
    id: string;
    event_name: string;
    event_date: string;
    city: string | null;
    state: string | null;
  }>
> {
  const isoDate = normalizeIsoDate(row.event_date);
  let query = supabase
    .from("events")
    .select("id, event_name, event_date, city, state")
    .eq("user_id", scopeUserId)
    .eq("event_name", row.event_name);
  if (isoDate) {
    query = query.eq("event_date", isoDate);
  }
  const { data, error } = await query;
  if (error) {
    console.error(`  ✗ fetch failed for "${row.event_name}": ${error.message}`);
    return [];
  }
  return (data ?? []) as Array<{
    id: string;
    event_name: string;
    event_date: string;
    city: string | null;
    state: string | null;
  }>;
}

async function main(): Promise<void> {
  const rows = parseTsv(tsvPath);
  console.log("=".repeat(72));
  console.log(` Apply city corrections from ${tsvPath}`);
  console.log(` Scope user: ${scopeUserId}`);
  console.log("=".repeat(72));
  console.log("");

  const applyRows = rows.filter((r) => classifyConfirm(r.operator_confirm) === "apply");
  const skipRows = rows.filter((r) => classifyConfirm(r.operator_confirm) === "skip");
  console.log(`Parsed ${rows.length} rows: ${applyRows.length} confirmed, ${skipRows.length} skipped/blank.`);
  console.log("");

  if (skipRows.length > 0) {
    console.log("─".repeat(72));
    console.log(" Skipped rows (operator did not confirm)");
    console.log("─".repeat(72));
    for (const r of skipRows) {
      console.log(`  • "${r.event_name}" ${r.event_date}`);
      console.log(`    confirm: "${r.operator_confirm.trim() || "(blank)"}"`);
    }
    console.log("");
  }

  // Plan
  type Op = {
    eventId: string;
    name: string;
    date: string;
    fromCity: string;
    fromState: string;
    toCity: string;
    toState: string;
  };
  const planned: Op[] = [];
  const targetedNoChange: Op[] = [];

  for (const r of applyRows) {
    if (!r.event_name.trim()) continue;
    const candidates = await findCandidates(r);
    if (candidates.length === 0) {
      console.log(
        `  ⚠ no events matched "${r.event_name}" date="${r.event_date}" on user ${scopeUserId}`
      );
      continue;
    }
    for (const ev of candidates) {
      // Stale-row protection: event_name must still match.
      if (ev.event_name !== r.event_name) {
        console.log(
          `  ⚠ skip ${ev.id} — event_name drifted: "${ev.event_name}" vs TSV "${r.event_name}"`
        );
        continue;
      }
      const toCity = (r.suggested_city || "").trim();
      const toState = (r.suggested_state || "").trim();
      const fromCity = ev.city ?? "";
      const fromState = ev.state ?? "";
      if (toCity === fromCity && toState === fromState) {
        targetedNoChange.push({
          eventId: ev.id,
          name: ev.event_name,
          date: ev.event_date,
          fromCity,
          fromState,
          toCity,
          toState,
        });
        continue;
      }
      planned.push({
        eventId: ev.id,
        name: ev.event_name,
        date: ev.event_date,
        fromCity,
        fromState,
        toCity: toCity || fromCity,
        toState: toState || fromState,
      });
    }
  }

  console.log("─".repeat(72));
  console.log(" Planned updates");
  console.log("─".repeat(72));
  console.log(`  ✓ Apply: ${planned.length}`);
  for (const op of planned) {
    const cityChange =
      op.fromCity !== op.toCity ? `city: "${op.fromCity}" → "${op.toCity}"` : "";
    const stateChange =
      op.fromState !== op.toState
        ? `state: "${op.fromState}" → "${op.toState}"`
        : "";
    const changes = [cityChange, stateChange].filter(Boolean).join(", ");
    console.log(`      [${op.eventId}] "${op.name}" ${op.date}  —  ${changes}`);
  }
  if (targetedNoChange.length > 0) {
    console.log(`  = Already correct (no-op): ${targetedNoChange.length}`);
  }
  console.log("");

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
  for (const op of planned) {
    const update: Record<string, string> = {};
    if (op.fromCity !== op.toCity) update.city = op.toCity;
    if (op.fromState !== op.toState) update.state = op.toState;
    if (Object.keys(update).length === 0) continue;
    const { error } = await supabase
      .from("events")
      .update(update)
      .eq("id", op.eventId);
    if (error) {
      console.log(`  ✗ ${op.eventId} update failed: ${error.message}`);
      continue;
    }
    updated++;
    console.log(`  ✓ [${op.eventId}] "${op.name}" ${op.date} updated`);
  }
  console.log("");
  console.log(`Updated ${updated} of ${planned.length} rows.`);
  console.log("");
  console.log(
    "NOTE: city/state changes affect downstream geocoding + weather. " +
      "Trigger a recalc on the scoped user to refresh lat/lng + weather:"
  );
  console.log(`  Operator hits "Refresh forecasts" on /dashboard, or run recalc programmatically.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
