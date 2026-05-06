#!/usr/bin/env node
// Operator diagnostic: find candidate event-merge pairs in production
// data, using the same fuzzy detection logic as PR #184's import-time
// dedupe (src/lib/event-duplicate-detection.ts). Output is a TSV the
// operator reviews to greenlight retroactive merges.
//
// Built for Julian's 2026-05-06 cleanup pass — PR #184 catches future
// imports, this script catches existing duplicates already in the DB.
//
// Three matching rules (mirrors event-duplicate-detection.ts):
//   1. Exact normalized match (case + whitespace insensitive).
//   2. Lev/Jaccard near-miss — apostrophe drift, plural/singular,
//      casing variants. Thresholds: lev_ratio OR jaccard >= 0.7,
//      jaccard floor 0.4.
//   3. Token-subset — smaller name's tokens (>2 chars, >=2 tokens)
//      are all contained in the larger name. Catches comma-prefixed
//      location duplicates that lev/jaccard miss.
//
// Per-pair, exact wins over fuzzy; within fuzzy, the highest-scoring
// same-date candidate wins.
//
// Output: TSV to stdout. Last column is `merge_decision` left blank
// for the operator to fill (auto / keep_a / keep_b / keep_both /
// not_dupe). Stderr footer summarizes by category.
//
// Read-only. Safe to run against prod.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/find-merge-candidates.mjs <user-email-or-uuid>

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const target = argv[0];

if (!target) {
  console.error(
    "Usage: node scripts/find-merge-candidates.mjs <user-email-or-uuid>"
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
// Fuzzy-match logic — direct port of src/lib/event-duplicate-detection.ts
// + src/lib/event-name-similarity.ts. Kept here as plain JS so the
// script runs without a TS toolchain.
// ─────────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

function levRatio(a, b) {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function tokenize(s) {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
}

function isTokenSubset(smaller, larger) {
  if (smaller.size < 2) return false;
  for (const t of smaller) if (!larger.has(t)) return false;
  return true;
}

function normalize(s) {
  return (s ?? "").trim().toLowerCase();
}

const MIN_RATIO = 0.7;
const MIN_JACCARD = 0.4;

/**
 * Compare two events on the same date. Returns null if no match,
 * otherwise { match_type, similarity_score }.
 */
function pairMatch(a, b) {
  const aNorm = normalize(a.event_name);
  const bNorm = normalize(b.event_name);
  if (aNorm === bNorm) {
    return { match_type: "exact", similarity_score: 1 };
  }
  const lr = levRatio(aNorm, bNorm);
  const jc = jaccard(aNorm, bNorm);
  if (jc >= MIN_JACCARD && (lr >= MIN_RATIO || jc >= MIN_RATIO)) {
    return { match_type: "fuzzy", similarity_score: Math.max(lr, jc) };
  }
  const aTokens = tokenize(aNorm);
  const bTokens = tokenize(bNorm);
  const [smaller, larger] =
    aTokens.size <= bTokens.size ? [aTokens, bTokens] : [bTokens, aTokens];
  if (isTokenSubset(smaller, larger)) {
    const score = larger.size > 0 ? smaller.size / larger.size : 0;
    return { match_type: "subset", similarity_score: score };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// User resolution
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// Pull events + group by date
// ─────────────────────────────────────────────────────────────────

const { data: events, error } = await supabase
  .from("events")
  .select(
    "id, event_date, event_name, city, location, pos_source, booked, net_sales, forecast_sales, created_at, cancellation_reason, is_sample"
  )
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

const byDate = new Map();
for (const e of events) {
  if (e.is_sample) continue;
  const list = byDate.get(e.event_date);
  if (list) list.push(e);
  else byDate.set(e.event_date, [e]);
}

// ─────────────────────────────────────────────────────────────────
// Pairwise scan within each same-date bucket
// ─────────────────────────────────────────────────────────────────

const candidates = [];
for (const [date, list] of byDate) {
  if (list.length < 2) continue;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const m = pairMatch(a, b);
      if (m) candidates.push({ a, b, ...m });
    }
  }
}

// Sort by score descending so highest-confidence pairs are first.
candidates.sort((x, y) => y.similarity_score - x.similarity_score);

// ─────────────────────────────────────────────────────────────────
// Heuristic auto-suggest: when one row has net_sales and the other
// doesn't, suggest keeping the one WITH sales. When both or neither
// have sales, leave the suggestion blank for operator review.
// ─────────────────────────────────────────────────────────────────

function suggest({ a, b }) {
  const aHasSales = a.net_sales !== null && a.net_sales !== undefined;
  const bHasSales = b.net_sales !== null && b.net_sales !== undefined;
  if (aHasSales && !bHasSales) return "keep_a";
  if (bHasSales && !aHasSales) return "keep_b";
  return ""; // ambiguous — operator decides
}

// ─────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────

console.log(
  [
    "event_date",
    "match_type",
    "similarity_score",
    "name_a",
    "name_b",
    "id_a",
    "id_b",
    "net_sales_a",
    "net_sales_b",
    "pos_source_a",
    "pos_source_b",
    "suggested",
    "merge_decision",
    "notes",
  ].join("\t")
);

for (const c of candidates) {
  console.log(
    [
      c.a.event_date,
      c.match_type,
      c.similarity_score.toFixed(3),
      c.a.event_name ?? "",
      c.b.event_name ?? "",
      c.a.id,
      c.b.id,
      c.a.net_sales ?? "",
      c.b.net_sales ?? "",
      c.a.pos_source ?? "",
      c.b.pos_source ?? "",
      suggest(c),
      "", // merge_decision (operator fills)
      "", // notes (operator scratch)
    ]
      .map((v) => String(v).replace(/\t/g, " ").replace(/\n/g, " "))
      .join("\t")
  );
}

// Stderr footer
const byMatchType = candidates.reduce((acc, c) => {
  acc[c.match_type] = (acc[c.match_type] ?? 0) + 1;
  return acc;
}, {});

const auto = candidates.filter((c) => suggest(c)).length;
const ambiguous = candidates.length - auto;

console.error("");
console.error(`# Candidate merge pairs: ${candidates.length}`);
console.error(`# By match type:`);
for (const [t, n] of Object.entries(byMatchType).sort((a, b) => b[1] - a[1])) {
  console.error(`#   ${t}: ${n}`);
}
console.error(`# Suggested resolutions:`);
console.error(`#   auto-suggested keep_a / keep_b (one row has sales, other doesn't): ${auto}`);
console.error(`#   ambiguous (both or neither have sales — operator decides): ${ambiguous}`);
console.error("");
console.error(`# Decisions to fill in column 13 (merge_decision):`);
console.error(`#   keep_a       — keep id_a, delete id_b`);
console.error(`#   keep_b       — keep id_b, delete id_a`);
console.error(`#   keep_both    — these aren't actually duplicates, leave both`);
console.error(`#   not_dupe     — same as keep_both, distinct events on the same date`);
console.error(`#   (blank)      — defer decision for now`);
