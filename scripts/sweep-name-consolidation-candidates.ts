#!/usr/bin/env node
// Surface candidate event_name clusters that look mergeable.
// READ-ONLY — does not modify data. Operator reviews TSV and decides
// which clusters to merge by adding rules to apply-event-consolidation.ts.
//
// Strategy (two passes, scored by confidence):
//
//   PASS 1 — Normalized-form match (HIGH confidence):
//     Lowercase, strip punctuation, strip common "edition" suffix
//     tokens (Edition, Special, Night, Edition, Version, etc.), strip
//     leading articles (The, A). Names that collapse to the same
//     normalized form are grouped. These are nearly-certain merges.
//
//   PASS 2 — Token-overlap clusters (MEDIUM confidence):
//     For names not grouped in PASS 1, compute Jaccard similarity on
//     space-split tokens. Pairs with similarity >= 0.6 cluster together.
//     Catches cases like "Finally Fridays" + "Finally Fridays at
//     Laumeier" + "Laumeier Fridays" that share most tokens but don't
//     normalize to the same form.
//
//   Suggested canonical: highest count in the cluster wins. Ties broken
//   by most-recent event_date (operator's current habit beats history).
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/sweep-name-consolidation-candidates.ts <user-id> [output-tsv-path]
//
// Default output: ./name-consolidation-candidates.tsv

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const outputPath = process.argv[3] ?? "./name-consolidation-candidates.tsv";
if (!userId) {
  console.error("Usage: npx tsx scripts/sweep-name-consolidation-candidates.ts <user-id> [output-tsv-path]");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Tokens that often differentiate "edition variants" of the same event
// (e.g. "Night at the Zoo - Jammin Edition" / "Night at the Zoo Roar
// & Pour Edition") but should collapse for clustering. Operator confirms
// each cluster, so being loose here is fine — false positives just
// surface as "kept distinct" once they review.
const EDITION_SUFFIX_TOKENS = new Set([
  "edition",
  "special",
  "version",
  "night",
  "day",
  "fest",
  "festival",
  "concert",
  "series",
  "party",
  "event",
  "show",
  "premiere",
]);

// Leading articles to strip.
const LEADING_ARTICLES = new Set(["the", "a", "an"]);

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // strip punctuation
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0);
}

function normalize(name: string): string {
  let tokens = tokenize(name);
  // Drop leading article.
  if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) {
    tokens = tokens.slice(1);
  }
  // Drop trailing edition-suffix tokens.
  while (tokens.length > 1 && EDITION_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  // Drop "at <X>" venue prefix-suffix (e.g. "Finally Fridays at Laumeier"
  // → drop "at laumeier"). Only when there's something to drop and the
  // result still has substance.
  const atIdx = tokens.indexOf("at");
  if (atIdx > 0 && atIdx < tokens.length - 1) {
    tokens = tokens.slice(0, atIdx);
  }
  return tokens.join(" ");
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((t) => b.has(t))).size;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

interface NameStats {
  name: string;
  count: number;
  lastSeen: string;
  normalized: string;
  tokens: Set<string>;
}

interface Cluster {
  id: number;
  members: NameStats[];
  canonical: string;
  confidence: "HIGH" | "MEDIUM";
}

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("event_name, event_date")
    .eq("user_id", userId);
  if (error) throw error;
  const allEvents = (data ?? []) as Pick<Event, "event_name" | "event_date">[];
  console.log(`\nTotal events: ${allEvents.length}`);

  // Aggregate per distinct event_name.
  const stats = new Map<string, NameStats>();
  for (const e of allEvents) {
    const name = e.event_name.trim();
    if (!name) continue;
    const existing = stats.get(name);
    if (existing) {
      existing.count++;
      if (e.event_date > existing.lastSeen) existing.lastSeen = e.event_date;
    } else {
      stats.set(name, {
        name,
        count: 1,
        lastSeen: e.event_date,
        normalized: normalize(name),
        tokens: new Set(tokenize(name)),
      });
    }
  }
  console.log(`Distinct event_names: ${stats.size}`);

  // PASS 1 — group by normalized form.
  const byNormalized = new Map<string, NameStats[]>();
  for (const s of stats.values()) {
    if (!s.normalized) continue;
    const arr = byNormalized.get(s.normalized) ?? [];
    arr.push(s);
    byNormalized.set(s.normalized, arr);
  }

  const clusters: Cluster[] = [];
  let nextClusterId = 1;
  const grouped = new Set<string>();

  for (const members of byNormalized.values()) {
    if (members.length < 2) continue;
    // Sort by count desc, then last_seen desc.
    members.sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
    clusters.push({
      id: nextClusterId++,
      members,
      canonical: members[0].name,
      confidence: "HIGH",
    });
    for (const m of members) grouped.add(m.name);
  }
  console.log(`PASS 1 — normalized-form clusters: ${clusters.length}`);

  // PASS 2 — Jaccard token-overlap on remaining names.
  const remaining = [...stats.values()].filter((s) => !grouped.has(s.name));
  // Only consider names with > 1 token (single-token names tend to be
  // venue names like "Charter" with no consolidation gain).
  const candidates = remaining.filter((s) => s.tokens.size >= 2);

  // Greedy clustering: walk pairs, group when similarity >= threshold.
  const SIMILARITY_THRESHOLD = 0.6;
  const assignedToCluster = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      const sim = jaccard(a.tokens, b.tokens);
      if (sim < SIMILARITY_THRESHOLD) continue;
      const aCid = assignedToCluster.get(a.name);
      const bCid = assignedToCluster.get(b.name);
      if (aCid === undefined && bCid === undefined) {
        const cid = nextClusterId++;
        const cluster: Cluster = {
          id: cid,
          members: [a, b],
          canonical: a.count >= b.count ? a.name : b.name,
          confidence: "MEDIUM",
        };
        clusters.push(cluster);
        assignedToCluster.set(a.name, cid);
        assignedToCluster.set(b.name, cid);
      } else if (aCid !== undefined && bCid === undefined) {
        const cluster = clusters.find((c) => c.id === aCid);
        if (cluster) {
          cluster.members.push(b);
          assignedToCluster.set(b.name, aCid);
        }
      } else if (bCid !== undefined && aCid === undefined) {
        const cluster = clusters.find((c) => c.id === bCid);
        if (cluster) {
          cluster.members.push(a);
          assignedToCluster.set(a.name, bCid);
        }
      }
      // If both already assigned to different clusters, skip — merging
      // clusters via Jaccard is risky without operator review.
    }
  }
  // Recompute canonical for medium-confidence clusters.
  for (const c of clusters) {
    if (c.confidence !== "MEDIUM") continue;
    c.members.sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
    c.canonical = c.members[0].name;
  }
  const mediumCount = clusters.filter((c) => c.confidence === "MEDIUM").length;
  console.log(`PASS 2 — token-overlap clusters: ${mediumCount}`);

  // Sort clusters by total event count descending — review high-volume first.
  clusters.sort((a, b) => {
    const aTotal = a.members.reduce((sum, m) => sum + m.count, 0);
    const bTotal = b.members.reduce((sum, m) => sum + m.count, 0);
    return bTotal - aTotal;
  });

  console.log(`\n${"=".repeat(78)}`);
  console.log(`CANDIDATE CLUSTERS — ${clusters.length} total`);
  console.log("=".repeat(78));

  // Console summary.
  for (const c of clusters.slice(0, 20)) {
    const totalEvents = c.members.reduce((sum, m) => sum + m.count, 0);
    console.log(
      `\n[${c.confidence}] cluster #${c.id} — ${totalEvents} events across ${c.members.length} names. Suggested canonical: "${c.canonical}"`
    );
    for (const m of c.members) {
      const marker = m.name === c.canonical ? "  ✓" : "   ";
      console.log(`${marker} ${String(m.count).padStart(3)}× ${m.name.padEnd(50)} (last seen ${m.lastSeen})`);
    }
  }
  if (clusters.length > 20) {
    console.log(`\n... and ${clusters.length - 20} more clusters in the TSV`);
  }

  // TSV output.
  const headers = [
    "cluster_id",
    "confidence",
    "is_canonical",
    "name",
    "count",
    "last_seen",
    "suggested_canonical",
    "operator_decision", // operator fills: APPROVE / REJECT / NEW_CANONICAL: <name>
  ];
  const lines = [headers.join("\t")];
  for (const c of clusters) {
    for (const m of c.members) {
      lines.push(
        [
          c.id,
          c.confidence,
          m.name === c.canonical ? "yes" : "no",
          m.name,
          m.count,
          m.lastSeen,
          c.canonical,
          "",
        ]
          .map((v) => String(v).replace(/\t/g, " "))
          .join("\t")
      );
    }
    // Blank line separator between clusters.
    lines.push("");
  }
  writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${clusters.length} clusters to ${outputPath}`);
  console.log(`Operator review: open in Excel, fill 'operator_decision' per cluster:`);
  console.log(`  APPROVE — accept the suggested canonical for the whole cluster`);
  console.log(`  REJECT  — keep these names distinct (cluster is a false positive)`);
  console.log(`  NEW_CANONICAL: <name> — use a different canonical name for the cluster`);
  console.log(`Then add NAME_MERGES entries to scripts/apply-event-consolidation.ts and re-apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
