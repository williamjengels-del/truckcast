#!/usr/bin/env node
// Cross-operator overlap diagnostic.
//
// Read-only. Service-role client. Safe to run anytime.
//
// Answers the Tier 1 #1 question: do any normalized event_names overlap
// between Wok-O Taco and Best Wurst today? If yes, platform-prior could
// fire on shared venues already and we are closer to demo-on than the
// 0% calibration audit suggests. If no overlap exists, the address-
// required cross-op canonicalization path is the real demo unblock.
//
// Reports:
//   - distinct event_name counts per operator (with normalization + dates spanned)
//   - exact normalized overlap (the demo-readiness signal)
//   - fuzzy overlap (lev/jaccard >= 0.7 or token-subset) — names that COULD
//     be canonicalized today via the admin alias UI
//   - platform_events table state: which buckets actually have operator_count >= 2
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/diagnose-cross-op-overlap.ts <user-id-A> <user-id-B>
//
// Defaults to Wok-O Taco (7f97040f-023d-4604-8b66-f5aa321c31de) if only
// one argument is provided; second operator must be passed.

import { createClient } from "@supabase/supabase-js";
import { levRatio, jaccard } from "../src/lib/event-name-similarity.ts";

const WOKO_USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";

const args = process.argv.slice(2);
let userA: string;
let userB: string | undefined;
if (args.length === 0) {
  // No args — auto-discover Best Wurst by business_name.
  userA = WOKO_USER_ID;
  userB = undefined;
} else if (args.length === 1) {
  userA = WOKO_USER_ID;
  userB = args[0];
} else {
  userA = args[0];
  userB = args[1];
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface ProfileRow {
  id: string;
  business_name: string | null;
  city: string | null;
  state: string | null;
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, business_name, city, state")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error(`profiles fetch failed for ${userId}:`, error.message);
    return null;
  }
  return data as ProfileRow | null;
}

async function discoverBestWurst(): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, business_name, city, state")
    .ilike("business_name", "%best wurst%");
  if (error) {
    console.error("best-wurst discovery failed:", error.message);
    return null;
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length === 0) {
    console.error(
      'No profile with business_name ilike "best wurst" found.'
    );
    return null;
  }
  if (rows.length > 1) {
    console.error(
      `Ambiguous: ${rows.length} profiles matched "best wurst". Pass user_id explicitly.`
    );
    for (const r of rows) console.error(`  ${r.id} — ${r.business_name}`);
    return null;
  }
  return rows[0];
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

async function loadEventNameStats(
  userId: string
): Promise<Map<string, EventNameStat>> {
  const out = new Map<string, EventNameStat>();
  let from = 0;
  const PAGE = 1000;
  // Loop pages so we don't silently truncate on operators with >1000 events.
  for (;;) {
    const { data, error } = await supabase
      .from("events")
      .select("event_name, event_date, net_sales, city")
      .eq("user_id", userId)
      .order("event_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`events fetch failed for ${userId}:`, error.message);
      break;
    }
    const rows = (data ?? []) as {
      event_name: string | null;
      event_date: string | null;
      net_sales: number | null;
      city: string | null;
    }[];
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
  best: number;
  reason: "fuzzy" | "subset";
  subset_score: number | null;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
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
      // Skip identical pairs (would have been exact).
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

interface PlatformEventRow {
  event_name_normalized: string;
  event_name_display: string;
  operator_count: number;
  total_instances: number;
  median_sales: number;
}

async function loadPlatformEventsByName(
  names: string[]
): Promise<Map<string, PlatformEventRow>> {
  if (names.length === 0) return new Map();
  const { data, error } = await supabase
    .from("platform_events")
    .select(
      "event_name_normalized, event_name_display, operator_count, total_instances, median_sales"
    )
    .in("event_name_normalized", names);
  if (error) {
    console.error("platform_events fetch failed:", error.message);
    return new Map();
  }
  const out = new Map<string, PlatformEventRow>();
  for (const row of (data ?? []) as PlatformEventRow[]) {
    out.set(row.event_name_normalized, row);
  }
  return out;
}

async function loadAllPlatformEvents(): Promise<PlatformEventRow[]> {
  const out: PlatformEventRow[] = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("platform_events")
      .select(
        "event_name_normalized, event_name_display, operator_count, total_instances, median_sales"
      )
      .order("operator_count", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("platform_events scan failed:", error.message);
      break;
    }
    const rows = (data ?? []) as PlatformEventRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function summarizeStats(stats: Map<string, EventNameStat>) {
  const total_events = Array.from(stats.values()).reduce(
    (a, s) => a + s.count,
    0
  );
  const with_sales = Array.from(stats.values()).reduce(
    (a, s) => a + s.with_sales,
    0
  );
  const distinct = stats.size;
  return { total_events, with_sales, distinct };
}

async function main() {
  console.log("=".repeat(70));
  console.log(" Cross-operator overlap diagnostic");
  console.log("=".repeat(70));

  const profileA = await loadProfile(userA);
  if (!profileA) {
    console.error(`Operator A (${userA}) not found in profiles.`);
    process.exit(1);
  }

  let profileB: ProfileRow | null;
  if (userB) {
    profileB = await loadProfile(userB);
  } else {
    profileB = await discoverBestWurst();
    if (profileB) userB = profileB.id;
  }
  if (!profileB || !userB) {
    console.error("Operator B not resolvable.");
    process.exit(1);
  }

  console.log("");
  console.log(
    `Operator A: ${profileA.business_name ?? "(no business name)"}  [${userA}]`
  );
  console.log(
    `            ${profileA.city ?? "—"}, ${profileA.state ?? "—"}`
  );
  console.log(
    `Operator B: ${profileB.business_name ?? "(no business name)"}  [${userB}]`
  );
  console.log(
    `            ${profileB.city ?? "—"}, ${profileB.state ?? "—"}`
  );

  console.log("");
  console.log("Loading event names...");
  const [statsA, statsB] = await Promise.all([
    loadEventNameStats(userA),
    loadEventNameStats(userB),
  ]);

  const sumA = summarizeStats(statsA);
  const sumB = summarizeStats(statsB);

  console.log("");
  console.log("-".repeat(70));
  console.log(" Per-operator event-name stats");
  console.log("-".repeat(70));
  console.log(
    `  A: ${sumA.distinct.toString().padStart(4)} distinct names   ${sumA.total_events
      .toString()
      .padStart(4)} events   ${sumA.with_sales.toString().padStart(4)} w/ net_sales > 0`
  );
  console.log(
    `  B: ${sumB.distinct.toString().padStart(4)} distinct names   ${sumB.total_events
      .toString()
      .padStart(4)} events   ${sumB.with_sales.toString().padStart(4)} w/ net_sales > 0`
  );

  // Exact normalized overlap.
  const exactKeys = new Set<string>();
  for (const k of statsA.keys()) if (statsB.has(k)) exactKeys.add(k);

  console.log("");
  console.log("=".repeat(70));
  console.log(" EXACT NORMALIZED OVERLAP — the demo-readiness signal");
  console.log("=".repeat(70));
  if (exactKeys.size === 0) {
    console.log(
      "  ⚠️  Zero exact-normalized overlap between operators A and B."
    );
    console.log(
      "      Platform-prior CANNOT fire today on name-keyed aggregates."
    );
    console.log(
      "      Address-required cross-op canonicalization is the real demo unblock."
    );
  } else {
    console.log(
      `  ${exactKeys.size} event name${
        exactKeys.size === 1 ? "" : "s"
      } match exactly (post-normalize):`
    );
    const sorted = Array.from(exactKeys).sort();
    for (const k of sorted) {
      const sA = statsA.get(k)!;
      const sB = statsB.get(k)!;
      console.log("");
      console.log(`  • "${sA.display}"  (norm: "${k}")`);
      console.log(
        `      A: ${sA.count} events, ${sA.with_sales} w/ sales, ${sA.first_date ?? "?"} → ${sA.last_date ?? "?"}, cities: ${Array.from(sA.cities).join(", ") || "—"}`
      );
      console.log(
        `      B: ${sB.count} events, ${sB.with_sales} w/ sales, ${sB.first_date ?? "?"} → ${sB.last_date ?? "?"}, cities: ${Array.from(sB.cities).join(", ") || "—"}`
      );
    }
  }

  // Fuzzy / subset overlap.
  const fuzzy = findFuzzyPairs(statsA, statsB, exactKeys);
  console.log("");
  console.log("=".repeat(70));
  console.log(
    " FUZZY / TOKEN-SUBSET OVERLAP — could be canonicalized via alias UI"
  );
  console.log("=".repeat(70));
  if (fuzzy.length === 0) {
    console.log("  No fuzzy or token-subset matches above thresholds.");
  } else {
    console.log(`  ${fuzzy.length} pair${fuzzy.length === 1 ? "" : "s"} found:`);
    for (const p of fuzzy.slice(0, 30)) {
      const tag =
        p.reason === "subset"
          ? `subset ${p.subset_score!.toFixed(2)}`
          : `lev ${p.lev.toFixed(2)} / jc ${p.jc.toFixed(2)}`;
      console.log("");
      console.log(`  • [${tag}]`);
      console.log(
        `      A: "${p.a.display}"   (${p.a.count} events, ${p.a.with_sales} w/ sales)`
      );
      console.log(
        `      B: "${p.b.display}"   (${p.b.count} events, ${p.b.with_sales} w/ sales)`
      );
    }
    if (fuzzy.length > 30) {
      console.log("");
      console.log(`  ...and ${fuzzy.length - 30} more (truncated at 30).`);
    }
  }

  // platform_events table state — for the exact-overlap names AND in aggregate.
  console.log("");
  console.log("=".repeat(70));
  console.log(" platform_events TABLE STATE");
  console.log("=".repeat(70));

  if (exactKeys.size > 0) {
    const platformRows = await loadPlatformEventsByName(Array.from(exactKeys));
    console.log("");
    console.log("  For the exact-overlap event names above:");
    for (const k of Array.from(exactKeys).sort()) {
      const row = platformRows.get(k);
      if (!row) {
        console.log(
          `    • "${k}" — NOT IN platform_events table (operator_count < 2 floor not met, or registry stale)`
        );
      } else {
        const fires = row.operator_count >= 2 ? "✅ would fire" : "❌";
        console.log(
          `    • "${k}" — operator_count=${row.operator_count}, total_instances=${row.total_instances}, median_sales=$${Math.round(row.median_sales)}  ${fires}`
        );
      }
    }
  }

  const allPlatform = await loadAllPlatformEvents();
  const multiOp = allPlatform.filter((r) => r.operator_count >= 2);
  console.log("");
  console.log(
    `  Total platform_events rows: ${allPlatform.length}    rows w/ operator_count >= 2: ${multiOp.length}`
  );
  if (multiOp.length > 0) {
    console.log("");
    console.log(
      "  Top buckets by operator_count (would fire platform-prior):"
    );
    for (const r of multiOp.slice(0, 20)) {
      console.log(
        `    • "${r.event_name_display}" — ops=${r.operator_count}, n=${r.total_instances}, med=$${Math.round(r.median_sales)}`
      );
    }
  }

  // Final verdict line.
  console.log("");
  console.log("=".repeat(70));
  console.log(" VERDICT");
  console.log("=".repeat(70));
  if (exactKeys.size === 0 && multiOp.length === 0) {
    console.log(
      "  ❌ DEMO DORMANT. No exact overlap between A and B. platform_events has no multi-op rows."
    );
    console.log("     Address-required canonicalization is the real unblock.");
  } else if (exactKeys.size > 0 && multiOp.length === 0) {
    console.log(
      "  ⚠️  Exact name overlap exists between A and B, but no platform_events rows have"
    );
    console.log(
      "     operator_count >= 2 yet. Likely cause: updatePlatformRegistry has not been"
    );
    console.log(
      "     re-run since the second operator's data was added. Action:"
    );
    console.log("     re-run the registry update (admin tool or recalc trigger).");
  } else {
    console.log(
      `  ✅ ${multiOp.length} platform_events bucket(s) have operator_count >= 2.`
    );
    console.log(
      "     Platform-prior CAN fire today on those buckets. Run a forecast on a"
    );
    console.log(
      "     shared venue and confirm the platform-prior firing rate is non-zero."
    );
  }

  console.log("");
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
