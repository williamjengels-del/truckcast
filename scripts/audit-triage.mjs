#!/usr/bin/env node
// Operator triage: build a single review TSV combining every signal
// that suggests a row's date may be wrong, the row is a phantom from
// the recovery process, or the row name conflicts with another. Built
// for Julian's 2026-05-06 cleanup pass after the screenshot triage
// surfaced systemic date-integrity issues from the 2026-04-21 data
// recovery.
//
// Categories per row (a row can hit multiple):
//   PHANTOM      — past date, manual pos_source, no net_sales, only
//                  forecast_sales. Most likely class for rows pulled
//                  from low-confidence sources during recovery.
//   DOW_MISMATCH — event has 3+ instances and 75%+ on a single
//                  day-of-week, but THIS row is on a different day.
//                  Catches the parser-shift / wrong-date class.
//   IMPORT_FLAG  — cross-referenced from the recovery CSV's
//                  import_flags column. Surfaces v2_only,
//                  recovered_from_backup, and the explicit
//                  airtable_source_has_date_error_fix_upstream
//                  flag. Requires the CSV path as second arg.
//
// Output: TSV to stdout. Last column is `action_decision` left blank
// for the operator to fill (keep / delete / fix-date / it_is_fine).
// Stderr gets a footer summary by category.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/audit-triage.mjs <user-email-or-uuid> [path-to-import-csv]
//
// Read-only. Safe to run against prod.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const target = argv[0];
const importCsvPath = argv[1] ?? null;

if (!target) {
  console.error(
    "Usage: node scripts/audit-triage.mjs <user-email-or-uuid> [path-to-import-csv]"
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

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);

let userId;
if (isUuid) {
  userId = target;
} else {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error(`auth.admin.listUsers failed: ${error.message}`);
    process.exit(2);
  }
  const match = data?.users?.find((u) => u.email?.toLowerCase() === target.toLowerCase());
  if (!match) {
    console.error(`No user with email "${target}"`);
    process.exit(2);
  }
  userId = match.id;
  console.error(`# Resolved ${target} -> ${userId}`);
}

const { data: events, error } = await supabase
  .from("events")
  .select("id, event_date, event_name, city, location, pos_source, booked, fee_type, net_sales, forecast_sales, is_sample, created_at, notes")
  .eq("user_id", userId)
  .order("event_date", { ascending: true });

if (error) {
  console.error(`events query failed: ${error.message}`);
  process.exit(2);
}

if (!events || events.length === 0) {
  console.error("No events found for user");
  process.exit(0);
}

// ── Pattern 1: PHANTOM-SUSPECT ─────────────────────────────────────
// Past date + manual pos_source + no net_sales + has forecast_sales.
const today = new Date().toISOString().split("T")[0];
const phantomFlag = (e) =>
  e.event_date < today &&
  e.pos_source === "manual" &&
  (e.net_sales === null || e.net_sales === undefined) &&
  e.forecast_sales !== null &&
  e.forecast_sales > 0 &&
  !e.is_sample;

// ── Pattern 2: DOW_MISMATCH ────────────────────────────────────────
// Compute the dominant day-of-week per event_name. Flag rows on a
// different DoW when the event has 3+ instances and 75%+ on one DoW.
function dayName(dateStr) {
  // YYYY-MM-DD parsed as local-noon to avoid TZ flips.
  const d = new Date(dateStr + "T12:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}
const byNameDow = new Map();
const byName = new Map();
for (const e of events) {
  if (e.event_date >= today) continue; // future events have no DoW signal yet
  const dow = dayName(e.event_date);
  byName.set(e.event_name, (byName.get(e.event_name) ?? 0) + 1);
  const key = `${e.event_name}\t${dow}`;
  byNameDow.set(key, (byNameDow.get(key) ?? 0) + 1);
}
const dominantDow = new Map();
for (const [key, count] of byNameDow) {
  const [name, dow] = key.split("\t");
  const cur = dominantDow.get(name);
  if (!cur || count > cur.count) dominantDow.set(name, { dow, count });
}
function dowFlag(e) {
  if (e.event_date >= today) return null;
  const total = byName.get(e.event_name) ?? 0;
  if (total < 3) return null;
  const dom = dominantDow.get(e.event_name);
  if (!dom) return null;
  const ratio = dom.count / total;
  if (ratio < 0.75) return null;
  const myDow = dayName(e.event_date);
  if (myDow === dom.dow) return null;
  return { myDow, expected: dom.dow, dominant: dom.count, total };
}

// ── Pattern 3: IMPORT_FLAG (optional, requires CSV) ────────────────
// Cross-reference production rows against the recovery CSV's
// import_flags column by matching airtable_record_id. Production
// notes column embeds the airtable_record_id during recovery (varies
// by import shape), so we also fall back to (event_date, event_name)
// as the join key when airtable_record_id isn't present in notes.
let importFlagByDateName = new Map();
let importFlagByAirtableId = new Map();
if (importCsvPath) {
  try {
    const raw = readFileSync(importCsvPath, "utf8");
    // Lightweight CSV parser — handles quoted fields, commas-in-quotes.
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    const header = parseCsvLine(lines[0]);
    const idxDate = header.indexOf("event_date");
    const idxName = header.indexOf("event_name");
    const idxFlag = header.indexOf("import_flags");
    const idxAirId = header.indexOf("airtable_record_id");
    if (idxDate < 0 || idxName < 0 || idxFlag < 0) {
      console.error(`# Import CSV missing required columns (event_date / event_name / import_flags). Skipping IMPORT_FLAG pattern.`);
    } else {
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const flag = cols[idxFlag];
        if (!flag) continue;
        const date = cols[idxDate];
        const name = cols[idxName];
        const airId = idxAirId >= 0 ? cols[idxAirId] : "";
        const key = `${date}\t${name}`;
        importFlagByDateName.set(key, flag);
        if (airId) importFlagByAirtableId.set(airId, flag);
      }
      console.error(`# Loaded ${importFlagByDateName.size} import-flag rows from ${importCsvPath}`);
    }
  } catch (e) {
    console.error(`# Failed to load import CSV (${importCsvPath}): ${e.message}`);
  }
}
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function importFlagFor(e) {
  if (importFlagByDateName.size === 0) return null;
  // Prefer airtable_record_id match if the production notes column
  // happens to embed it (older recovery shapes did this; newer don't).
  if (e.notes) {
    const m = e.notes.match(/rec[A-Za-z0-9]{14,}/);
    if (m && importFlagByAirtableId.has(m[0])) return importFlagByAirtableId.get(m[0]);
  }
  return importFlagByDateName.get(`${e.event_date}\t${e.event_name}`) ?? null;
}

// ── Build triage rows ──────────────────────────────────────────────
const triage = [];
for (const e of events) {
  const cats = [];
  if (phantomFlag(e)) cats.push("PHANTOM");
  const dow = dowFlag(e);
  if (dow) cats.push(`DOW_MISMATCH(${dow.myDow}_vs_${dow.expected}_${dow.dominant}of${dow.total})`);
  const flag = importFlagFor(e);
  if (flag) {
    if (flag.includes("airtable_source_has_date_error_fix_upstream")) cats.push("KNOWN_BAD_DATE");
    if (flag.includes("source_v2_only_not_in_airtable")) cats.push("V2_ONLY");
    if (flag.includes("recovered_from_backup_base_2023")) cats.push("RECOVERED");
    if (flag.includes("placeholder_never_completed")) cats.push("PLACEHOLDER");
  }
  if (cats.length === 0) continue;
  triage.push({ event: e, categories: cats });
}

// ── Output ─────────────────────────────────────────────────────────
console.log(
  [
    "id",
    "event_date",
    "event_name",
    "city",
    "location",
    "pos_source",
    "net_sales",
    "forecast_sales",
    "dow",
    "categories",
    "action_decision", // operator fills: keep / delete / fix-date:YYYY-MM-DD / it_is_fine
    "notes_for_review",
  ].join("\t")
);
for (const { event: e, categories } of triage) {
  console.log(
    [
      e.id,
      e.event_date,
      e.event_name ?? "",
      e.city ?? "",
      e.location ?? "",
      e.pos_source ?? "",
      e.net_sales ?? "",
      e.forecast_sales ?? "",
      dayName(e.event_date),
      categories.join("|"),
      "", // action_decision
      "", // notes_for_review
    ]
      .map((v) => String(v).replace(/\t/g, " ").replace(/\n/g, " "))
      .join("\t")
  );
}

// Stderr footer.
const catCounts = {};
for (const { categories } of triage) {
  for (const c of categories) {
    const bucket = c.startsWith("DOW_MISMATCH") ? "DOW_MISMATCH" : c;
    catCounts[bucket] = (catCounts[bucket] ?? 0) + 1;
  }
}
console.error("");
console.error(`# Triage rows: ${triage.length}`);
console.error(`# By category (rows can match multiple):`);
for (const [c, n] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
  console.error(`#   ${c}: ${n}`);
}
console.error("");
console.error(`# Action decisions to fill in column 11:`);
console.error(`#   keep                  — row is correct, leave it`);
console.error(`#   delete                — row is a phantom, drop it`);
console.error(`#   fix-date:YYYY-MM-DD   — date is wrong, change to this`);
console.error(`#   it_is_fine            — flagged but actually correct (e.g. multi-day event, real off-pattern booking)`);
