#!/usr/bin/env node
// Find event rows whose names should be consolidated under a canonical
// name. Operator-flagged 2026-05-12: same-event-different-name drift
// makes the events list visually noisy and breaks forecast-engine
// per-name aggregation.
//
// Specific mappings operator confirmed (extend the RENAME_RULES list
// when more come up):
//   "Ticketed Event"          → "Chesterfield Amphitheater"  (when location matches)
//   "Sounds of Summer"        → "Chesterfield Amphitheater"
//   "National Geospace Lunch" → "NGA 2nd Street Lunch"
//   "Hidden Gem Bar"          → "Hidden Gems Bar"   (singular → plural)
//
// Read-only. Outputs candidate TSV for operator to review before any
// rename is applied via the companion apply-renames script (or by
// hand in the UI).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/find-rename-candidates.ts <user-id>

import { createClient } from "@supabase/supabase-js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/find-rename-candidates.ts <user-id>");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface RenameRule {
  matchName: (name: string) => boolean;
  matchLocation?: (loc: string | null) => boolean;
  canonical: string;
  note: string;
}

const RENAME_RULES: RenameRule[] = [
  {
    matchName: (n) => /^ticketed event$/i.test(n.trim()),
    matchLocation: (l) => !!l && /chesterfield amphitheater/i.test(l),
    canonical: "Chesterfield Amphitheater",
    note: "Ticketed Event @ Chesterfield Amphitheater → consolidate under venue name",
  },
  {
    matchName: (n) => /^sounds of summer$/i.test(n.trim()),
    canonical: "Chesterfield Amphitheater",
    note: "Sounds of Summer → Chesterfield Amphitheater (operator confirmed same event)",
  },
  {
    matchName: (n) => /national geospace lunch/i.test(n),
    canonical: "NGA 2nd Street Lunch",
    note: "National Geospace Lunch → NGA 2nd Street Lunch (NGA = National Geospatial-Intelligence Agency, same location)",
  },
  {
    matchName: (n) => /^hidden gem bar$/i.test(n.trim()),
    canonical: "Hidden Gems Bar",
    note: "Hidden Gem Bar (singular) → Hidden Gems Bar (plural canonical)",
  },
];

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("id, event_name, event_date, location, city, booked, net_sales, anomaly_flag, pos_source")
    .eq("user_id", userId)
    .order("event_date", { ascending: true });
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const candidates: Array<{
    event_id: string;
    event_date: string;
    current_name: string;
    canonical: string;
    location: string;
    net_sales: number | null;
    booked: boolean;
    note: string;
  }> = [];

  for (const e of data ?? []) {
    for (const rule of RENAME_RULES) {
      if (!rule.matchName(e.event_name ?? "")) continue;
      const loc = e.location ?? e.city ?? null;
      if (rule.matchLocation && !rule.matchLocation(loc)) continue;
      // Skip if already canonical
      if ((e.event_name ?? "").trim() === rule.canonical) continue;
      candidates.push({
        event_id: e.id,
        event_date: e.event_date,
        current_name: e.event_name ?? "",
        canonical: rule.canonical,
        location: loc ?? "",
        net_sales: e.net_sales == null ? null : Number(e.net_sales),
        booked: e.booked,
        note: rule.note,
      });
      break; // first matching rule wins
    }
  }

  // Header
  process.stdout.write(
    [
      "event_date",
      "current_name",
      "suggested_canonical",
      "location",
      "net_sales",
      "booked",
      "rationale",
      "decision",
      "event_id",
    ].join("\t") + "\n"
  );

  for (const c of candidates) {
    process.stdout.write(
      [
        c.event_date,
        c.current_name,
        c.canonical,
        c.location,
        c.net_sales ?? "",
        c.booked ? "true" : "false",
        c.note,
        "", // decision: operator fills "apply" / "keep" / blank
        c.event_id,
      ]
        .map((v) => String(v).replace(/\t/g, " ").replace(/\n/g, " "))
        .join("\t") + "\n"
    );
  }

  // Footer summary
  const byRule = new Map<string, number>();
  for (const c of candidates) {
    byRule.set(c.canonical, (byRule.get(c.canonical) ?? 0) + 1);
  }
  console.error(`\nFound ${candidates.length} rename candidates:`);
  for (const [k, v] of byRule.entries()) {
    console.error(`  → "${k}": ${v} rows`);
  }
  console.error(`\nOperator fills column 8 (decision):`);
  console.error(`  apply   — rename to suggested_canonical`);
  console.error(`  keep    — leave as-is (don't rename)`);
  console.error(`  (blank) — defer`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
