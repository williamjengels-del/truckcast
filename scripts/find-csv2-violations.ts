#!/usr/bin/env node
// Read-only: find rows that would violate the proposed
// (user_id, event_name, event_date) unique constraint before we add it.
// The unique index migration cannot be applied while violators exist.
//
// Reports per-operator dup counts + sample tuples + same-date pairs
// (which legitimately exist for some venues — e.g., a noon shift and
// an evening shift on the same date at the same name) so the operator
// can decide row-by-row whether to keep both, merge, or delete one.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/find-csv2-violations.ts

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface Row {
  id: string;
  user_id: string;
  event_name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  net_sales: number | null;
  created_at: string;
}

async function loadAll(): Promise<Row[]> {
  const out: Row[] = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("events")
      .select(
        "id, user_id, event_name, event_date, start_time, end_time, net_sales, created_at"
      )
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(error.message);
      break;
    }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadBusinessNames(
  userIds: string[]
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("profiles")
    .select("id, business_name")
    .in("id", userIds);
  const m = new Map<string, string>();
  for (const p of (data ?? []) as { id: string; business_name: string | null }[]) {
    m.set(p.id, p.business_name ?? "(no business name)");
  }
  return m;
}

async function main() {
  const all = await loadAll();
  console.log(`Total events loaded: ${all.length}`);

  // Group by (user_id, lower(trim(event_name)), event_date)
  const groups = new Map<string, Row[]>();
  for (const r of all) {
    if (!r.event_name || !r.event_date) continue;
    const key = `${r.user_id}|${r.event_name.toLowerCase().trim()}|${r.event_date}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const violators = Array.from(groups.entries()).filter(([_, rs]) => rs.length > 1);
  console.log(`Tuples violating (user_id, lower(event_name), event_date) uniqueness: ${violators.length}`);

  const userIds = new Set<string>();
  for (const [_, rs] of violators) for (const r of rs) userIds.add(r.user_id);
  const labels = await loadBusinessNames(Array.from(userIds));

  // Per-operator summary
  const byOp = new Map<string, number>();
  for (const [_, rs] of violators) {
    const uid = rs[0].user_id;
    byOp.set(uid, (byOp.get(uid) ?? 0) + 1);
  }
  console.log("");
  console.log("Per-operator violator count:");
  for (const [uid, n] of Array.from(byOp.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${labels.get(uid) ?? uid}  [${uid}]`);
  }

  // Sample violator detail (first 20)
  console.log("");
  console.log("First 20 violator tuples (oldest first by event_date):");
  violators.sort((a, b) => a[1][0].event_date.localeCompare(b[1][0].event_date));
  for (const [key, rs] of violators.slice(0, 20)) {
    const [uid] = key.split("|");
    console.log("");
    console.log(`  ${labels.get(uid)}  →  ${rs[0].event_name}  ·  ${rs[0].event_date}  (${rs.length} rows)`);
    for (const r of rs) {
      const sales = r.net_sales != null ? `$${r.net_sales}` : "—";
      const time =
        r.start_time || r.end_time
          ? `${r.start_time ?? "?"}-${r.end_time ?? "?"}`
          : "no time";
      console.log(`    • id=${r.id.slice(0, 8)}  ${time}  sales=${sales}  created=${r.created_at.slice(0, 10)}`);
    }
  }
  if (violators.length > 20) {
    console.log("");
    console.log(`...and ${violators.length - 20} more.`);
  }

  // Stricter check: also same start_time would mean true exact dup.
  console.log("");
  let trueDups = 0;
  let timeDistinctDups = 0;
  for (const [_, rs] of violators) {
    const distinctTimes = new Set(rs.map((r) => `${r.start_time ?? ""}|${r.end_time ?? ""}`));
    if (distinctTimes.size === 1) trueDups += 1;
    else timeDistinctDups += 1;
  }
  console.log(`Of ${violators.length} violator tuples:`);
  console.log(`  ${trueDups} have identical start_time/end_time (true duplicates)`);
  console.log(`  ${timeDistinctDups} have different times (legitimate same-day pairs, e.g., AM + PM shifts)`);
  console.log("");
  console.log("Implication: a (user_id, event_name, event_date) unique index would BREAK on the");
  console.log("legitimate same-day pairs. A 4-column (user_id, event_name, event_date, start_time)");
  console.log("unique index is the more accurate constraint for CSV-import dedupe.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
