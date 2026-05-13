#!/usr/bin/env node
// Export fuzzy-overlap event_name candidates between two operators as a
// TSV, formatted for operator decision-per-row walkthrough.
//
// Read-only. Service-role client. Companion to
// scripts/diagnose-cross-op-overlap.ts (which prints the same pairs in a
// human-readable form alongside other stats). This script outputs just
// the fuzzy/subset pairs in TSV with blank operator-decision columns so
// the operator can review in a spreadsheet, mark per-row decisions, and
// either click through the admin alias UI at /dashboard/admin/event-aliases
// or hand the marked TSV to a future apply script.
//
// Output goes to stdout; redirect to a file:
//   npx tsx --env-file=.env.local scripts/export-fuzzy-overlap-tsv.ts \
//     > Briefs/fuzzy-overlap-candidates-2026-05-14.tsv
//
// Default operator pair: Wok-O Taco vs Best Wurst (auto-discovered by
// business_name). Override with explicit user_ids:
//   ... export-fuzzy-overlap-tsv.ts <user-id-A> <user-id-B>
//
// Columns:
//   name_a             — operator A's display string for the event
//   name_b             — operator B's display string for the event
//   match_type         — "fuzzy" or "subset"
//   best_score         — max(lev, jaccard) for fuzzy, subset_score for subset
//   lev_ratio          — Levenshtein similarity (0-1)
//   jaccard            — Jaccard token similarity (0-1)
//   subset_score       — token-subset coverage (0-1); blank for fuzzy
//   n_a                — count of events on operator A
//   w_sales_a          — count w/ net_sales > 0 on operator A
//   first_date_a       — earliest event_date on operator A
//   last_date_a        — latest event_date on operator A
//   cities_a           — pipe-delimited cities on operator A
//   n_b                — count on operator B
//   w_sales_b          — count w/ net_sales > 0 on operator B
//   first_date_b       — earliest on operator B
//   last_date_b        — latest on operator B
//   cities_b           — pipe-delimited cities on operator B
//   suggested_canon    — Claude-suggested canonical (longer-token form OR more-sales form); for operator reference
//   operator_decision  — BLANK; operator fills with: merge | distinct | needs-review | skip
//   operator_canon     — BLANK; operator fills with chosen canonical name when decision=merge
//   notes              — BLANK; operator notes
//
// Source pairing logic mirrors diagnose-cross-op-overlap.ts exactly so
// the candidate set is identical. Privacy: only event names + counts,
// no per-event row dumps. No operator-named output beyond business_name
// references in the header.

import { createClient } from "@supabase/supabase-js";
import { levRatio, jaccard } from "../src/lib/event-name-similarity.ts";

const WOKO_USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  process.stderr.write(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.\n"
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface ProfileRow {
  id: string;
  business_name: string | null;
}

interface EventNameStat {
  display: string;
  normalized: string;
  count: number;
  first_date: string | null;
  last_date: string | null;
  with_sales: number;
  cities: Set<string>;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, business_name")
    .eq("id", userId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

async function discoverBestWurst(): Promise<ProfileRow | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, business_name")
    .ilike("business_name", "%best wurst%");
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length !== 1) return null;
  return rows[0];
}

async function loadEventNameStats(
  userId: string
): Promise<Map<string, EventNameStat>> {
  const out = new Map<string, EventNameStat>();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("events")
      .select("event_name, event_date, net_sales, city")
      .eq("user_id", userId)
      .order("event_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      process.stderr.write(`events fetch failed for ${userId}: ${error.message}\n`);
      break;
    }
    const rows = (data ?? []) as Array<{
      event_name: string | null;
      event_date: string | null;
      net_sales: number | null;
      city: string | null;
    }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!r.event_name) continue;
      const norm = normalize(r.event_name);
      if (!norm) continue;
      const cur = out.get(norm);
      if (cur) {
        cur.count += 1;
        if (r.event_date) {
          if (!cur.first_date || r.event_date < cur.first_date)
            cur.first_date = r.event_date;
          if (!cur.last_date || r.event_date > cur.last_date)
            cur.last_date = r.event_date;
        }
        if (r.net_sales != null && r.net_sales > 0) cur.with_sales += 1;
        if (r.city) cur.cities.add(r.city);
      } else {
        out.set(norm, {
          display: r.event_name,
          normalized: norm,
          count: 1,
          first_date: r.event_date,
          last_date: r.event_date,
          with_sales: r.net_sales != null && r.net_sales > 0 ? 1 : 0,
          cities: new Set(r.city ? [r.city] : []),
        });
      }
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

interface FuzzyPair {
  a: EventNameStat;
  b: EventNameStat;
  lev: number;
  jc: number;
  reason: "fuzzy" | "subset";
  subset_score: number | null;
  best: number;
}

function findFuzzyPairs(
  a: Map<string, EventNameStat>,
  b: Map<string, EventNameStat>,
  exactKeys: Set<string>
): FuzzyPair[] {
  const out: FuzzyPair[] = [];
  const minRatio = 0.7;
  const minJaccard = 0.4;
  for (const [normA, statA] of a) {
    if (exactKeys.has(normA)) continue;
    const tokensA = tokenize(normA);
    for (const [normB, statB] of b) {
      if (exactKeys.has(normB)) continue;
      if (normA === normB) continue;
      const lr = levRatio(normA, normB);
      const jc = jaccard(normA, normB);
      if (jc >= minJaccard && (lr >= minRatio || jc >= minRatio)) {
        out.push({
          a: statA,
          b: statB,
          lev: lr,
          jc,
          best: Math.max(lr, jc),
          reason: "fuzzy",
          subset_score: null,
        });
        continue;
      }
      const tokensB = tokenize(normB);
      const [smaller, larger] =
        tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
      if (smaller.size === 0 || larger.size === 0) continue;
      let allIn = true;
      for (const t of smaller) {
        if (!larger.has(t)) {
          allIn = false;
          break;
        }
      }
      if (allIn) {
        const score = smaller.size / larger.size;
        if (score >= 0.5) {
          out.push({
            a: statA,
            b: statB,
            lev: lr,
            jc,
            best: score,
            reason: "subset",
            subset_score: score,
          });
        }
      }
    }
  }
  out.sort((x, y) => y.best - x.best);
  return out;
}

function tsvCell(v: string | number | null): string {
  if (v == null) return "";
  return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function suggestCanonical(p: FuzzyPair): string {
  // Heuristic: pick the candidate with more events-with-sales (more
  // signal); tie-break by longer normalized token count (more specific).
  // This is operator-reference only — they can override.
  if (p.a.with_sales !== p.b.with_sales) {
    return p.a.with_sales > p.b.with_sales ? p.a.display : p.b.display;
  }
  const tokA = tokenize(p.a.normalized).size;
  const tokB = tokenize(p.b.normalized).size;
  return tokA >= tokB ? p.a.display : p.b.display;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let userA: string;
  let userB: string;
  if (args.length === 0) {
    userA = WOKO_USER_ID;
    const bw = await discoverBestWurst();
    if (!bw) {
      process.stderr.write("Could not auto-discover Best Wurst; pass user_ids explicitly.\n");
      process.exit(2);
    }
    userB = bw.id;
  } else if (args.length === 1) {
    userA = WOKO_USER_ID;
    userB = args[0];
  } else {
    userA = args[0];
    userB = args[1];
  }

  const [profA, profB] = await Promise.all([loadProfile(userA), loadProfile(userB)]);
  process.stderr.write(
    `Operator A: ${profA?.business_name ?? "(no business)"}  [${userA}]\n` +
      `Operator B: ${profB?.business_name ?? "(no business)"}  [${userB}]\n` +
      `\nLoading event names…\n`
  );

  const [statsA, statsB] = await Promise.all([
    loadEventNameStats(userA),
    loadEventNameStats(userB),
  ]);
  process.stderr.write(
    `  A: ${statsA.size} distinct names\n  B: ${statsB.size} distinct names\n`
  );

  const exactKeys = new Set<string>();
  for (const k of statsA.keys()) if (statsB.has(k)) exactKeys.add(k);
  process.stderr.write(`Exact-overlap names (excluded from fuzzy set): ${exactKeys.size}\n`);

  const pairs = findFuzzyPairs(statsA, statsB, exactKeys);
  process.stderr.write(`Fuzzy + subset pairs: ${pairs.length}\n\n`);

  // Header
  const header = [
    "name_a",
    "name_b",
    "match_type",
    "best_score",
    "lev_ratio",
    "jaccard",
    "subset_score",
    "n_a",
    "w_sales_a",
    "first_date_a",
    "last_date_a",
    "cities_a",
    "n_b",
    "w_sales_b",
    "first_date_b",
    "last_date_b",
    "cities_b",
    "suggested_canon",
    "operator_decision",
    "operator_canon",
    "notes",
  ];
  process.stdout.write(header.join("\t") + "\n");

  for (const p of pairs) {
    const row = [
      tsvCell(p.a.display),
      tsvCell(p.b.display),
      tsvCell(p.reason),
      tsvCell(p.best.toFixed(2)),
      tsvCell(p.lev.toFixed(2)),
      tsvCell(p.jc.toFixed(2)),
      tsvCell(p.subset_score != null ? p.subset_score.toFixed(2) : ""),
      tsvCell(p.a.count),
      tsvCell(p.a.with_sales),
      tsvCell(p.a.first_date),
      tsvCell(p.a.last_date),
      tsvCell([...p.a.cities].join("|")),
      tsvCell(p.b.count),
      tsvCell(p.b.with_sales),
      tsvCell(p.b.first_date),
      tsvCell(p.b.last_date),
      tsvCell([...p.b.cities].join("|")),
      tsvCell(suggestCanonical(p)),
      "", // operator_decision
      "", // operator_canon
      "", // notes
    ];
    process.stdout.write(row.join("\t") + "\n");
  }

  process.stderr.write(`\nWrote ${pairs.length} rows to stdout. Pipe to a file:\n`);
  process.stderr.write(
    `  npx tsx --env-file=.env.local scripts/export-fuzzy-overlap-tsv.ts > Briefs/fuzzy-overlap-candidates-YYYY-MM-DD.tsv\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err}\n`);
  process.exit(1);
});
