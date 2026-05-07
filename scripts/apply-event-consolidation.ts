#!/usr/bin/env node
// Apply event-name merges, time pattern fills, multi-day splits, and
// the Millipond Brewing → Millstadt IL backfill. Source of truth:
// project_woko_event_consolidation_rules.md (operator-confirmed
// 2026-05-07). All times CST.
//
// Three operations bundled because they're conceptually one
// "consolidation pass" — operator sees a single proposal sheet
// covering name merges + time normalization + venue-derived city
// fixes — and the recalc afterwards runs once on a fully-consolidated
// dataset.
//
// Dry-run by default. Pass --apply to write. Per the no-auto-fix
// rule, operator confirms the dry-run before --apply runs.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/apply-event-consolidation.ts <user-id>           # dry-run
//   npx tsx scripts/apply-event-consolidation.ts <user-id> --apply   # writes

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const apply = process.argv.includes("--apply");
const outputPath = "./event-consolidation-proposals.tsv";

if (!userId) {
  console.error("Usage: npx tsx scripts/apply-event-consolidation.ts <user-id> [--apply]");
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// === RULES ===

// True-duplicate merges. Each entry: { from: [old names], to: canonical }.
// Names compared case-insensitively after trim.
const NAME_MERGES: Array<{ from: string[]; to: string }> = [
  { from: ["Night at the Zoo"], to: "Jammin' at the Zoo" },
  { from: ["Finally Fridays", "Finally Friday"], to: "Laumeier Fridays" },
  {
    from: ["St. Patrick's Day Parade"],
    to: "Downtown St. Patrick's Day Parade",
  },
  { from: ["Hot Summer Nights"], to: "Summer Concert Series" },
];

// Pattern-fill venue rules. Each rule defines setup/start/end times
// for events whose event_name matches the regex. Single-shift only —
// venues with multiple valid shifts (9 Mile Garden, Scott AFB) are
// excluded from this script per operator's "per existing raw value"
// note.
interface VenueTimeRule {
  pattern: RegExp;
  setup: string;
  start: string;
  end: string;
  label: string;
}

const VENUE_TIME_RULES: VenueTimeRule[] = [
  { pattern: /^charter\s+/i, setup: "10:00", start: "10:30", end: "13:30", label: "Charter (all schools)" },
  { pattern: /^party\s+in\s+the\s+park/i, setup: "16:30", start: "17:00", end: "20:00", label: "Party in the Park" },
  { pattern: /^hidden\s+gems/i, setup: "18:00", start: "19:00", end: "01:00", label: "Hidden Gems" },
  { pattern: /^hoffman\s+brothers/i, setup: "10:00", start: "11:00", end: "13:00", label: "Hoffman Brothers" },
  { pattern: /^lunchtime\s+live/i, setup: "10:00", start: "11:00", end: "13:30", label: "Lunchtime Live" },
  { pattern: /^chesterfield\s+amphitheater/i, setup: "17:00", start: "17:30", end: "21:30", label: "Chesterfield Amphitheater" },
  { pattern: /^laumeier\s+after\s+dark/i, setup: "15:00", start: "16:00", end: "20:00", label: "Laumeier After Dark" },
  { pattern: /^fenton\s+food\s+truck\s+fridays?/i, setup: "16:00", start: "17:00", end: "21:00", label: "Fenton Food Truck Fridays" },
  { pattern: /armory|pickle\s+fest|12\s+days\s+of\s+charity/i, setup: "11:00", start: "12:00", end: "18:00", label: "Armory" },
  { pattern: /^harvest\s+fest/i, setup: "10:00", start: "11:00", end: "17:00", label: "Harvest Fest" },
  { pattern: /^grub\s+n\s+groove/i, setup: "11:00", start: "14:00", end: "22:00", label: "Grub n Groove" },
  { pattern: /^food\s+truck\s+fridays?$/i, setup: "15:00", start: "16:00", end: "20:00", label: "Food Truck Fridays" },
];

// Multi-day events with per-day-of-cluster time patterns. Each rule
// matches events by name pattern, then assigns times based on the
// event's position within its cluster (sorted by date ascending).
interface MultiDayRule {
  pattern: RegExp;
  /** Array indexed by day-of-cluster (0 = first day). Each entry is
   *  the times for that day. */
  days: Array<{ setup: string; start: string; end: string }>;
  label: string;
}

const MULTI_DAY_RULES: MultiDayRule[] = [
  {
    pattern: /^best\s+of\s+missouri/i,
    days: [
      { setup: "09:00", start: "11:00", end: "17:00" }, // Friday
      { setup: "07:00", start: "08:00", end: "19:00" }, // Saturday
      { setup: "08:00", start: "09:00", end: "17:00" }, // Sunday
    ],
    label: "Best of Missouri Festival",
  },
  {
    pattern: /^brentwood\s+days/i,
    days: [
      { setup: "16:00", start: "17:00", end: "22:00" }, // Day 1
      { setup: "10:00", start: "11:00", end: "21:00" }, // Day 2
    ],
    label: "Brentwood Days",
  },
  {
    pattern: /^downtown\s+pride/i,
    days: [
      { setup: "10:00", start: "11:00", end: "19:00" }, // 6/29 (Day 1)
      { setup: "10:00", start: "11:00", end: "18:00" }, // 6/30 (Day 2)
    ],
    label: "Downtown Pride",
  },
];

// Specific-event city/state backfills. Operator-confirmed venues that
// don't have city populated and need it set so weather classification
// + state defaulting work.
const VENUE_LOCATION_BACKFILLS: Array<{ pattern: RegExp; city: string; state: string }> = [
  { pattern: /^millipond\s+brewing/i, city: "Millstadt", state: "IL" },
];

// === END RULES ===

interface Proposal {
  eventId: string;
  eventDate: string;
  oldName: string;
  newName: string;
  oldCity: string | null;
  newCity: string | null;
  oldState: string | null;
  newState: string | null;
  oldStart: string | null;
  newStart: string | null;
  oldEnd: string | null;
  newEnd: string | null;
  oldSetup: string | null;
  newSetup: string | null;
  reason: string;
}

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function timeMatches(stored: string | null | undefined, target: string): boolean {
  if (!stored) return false;
  // Compare just HH:MM portion.
  return stored.slice(0, 5) === target.slice(0, 5);
}

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("id, event_date, event_name, city, state, start_time, end_time, setup_time")
    .eq("user_id", userId)
    .order("event_date", { ascending: true });
  if (error) throw error;
  const allEvents = (data ?? []) as Pick<
    Event,
    "id" | "event_date" | "event_name" | "city" | "state" | "start_time" | "end_time" | "setup_time"
  >[];
  console.log(`\nTotal events: ${allEvents.length}`);

  // Build merge lookup once.
  const mergeLookup = new Map<string, string>();
  for (const m of NAME_MERGES) {
    for (const orig of m.from) {
      mergeLookup.set(normalizeName(orig), m.to);
    }
  }

  // Build multi-day cluster index — for each rule, group events by
  // the rule's pattern, sort by date, assign day-of-cluster index.
  // Multi-day clusters are detected as runs of dates within
  // SERIES_MAX_GAP_DAYS=5 of each other. Mirrors the engine's
  // series-day logic.
  const SERIES_MAX_GAP_DAYS = 5;
  function clusterDates(dates: string[]): string[][] {
    const sorted = [...new Set(dates)].sort();
    if (sorted.length === 0) return [];
    const clusters: string[][] = [];
    let current: string[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + "T00:00:00").getTime();
      const cur = new Date(sorted[i] + "T00:00:00").getTime();
      const gap = (cur - prev) / 86400000;
      if (gap <= SERIES_MAX_GAP_DAYS) {
        current.push(sorted[i]);
      } else {
        clusters.push(current);
        current = [sorted[i]];
      }
    }
    clusters.push(current);
    return clusters;
  }

  // Per multi-day rule: compute clusters and dayIndex per (event_id).
  const multiDayDayIndex = new Map<string, number>(); // event_id → 0/1/2 day-of-cluster
  const multiDayRuleAssignment = new Map<string, MultiDayRule>(); // event_id → which rule
  for (const rule of MULTI_DAY_RULES) {
    const matchingEvents = allEvents.filter((e) => rule.pattern.test(e.event_name));
    const dates = matchingEvents.map((e) => e.event_date);
    const clusters = clusterDates(dates);
    for (const cluster of clusters) {
      cluster.forEach((d, idx) => {
        const eventsOnDay = matchingEvents.filter((e) => e.event_date === d);
        for (const e of eventsOnDay) {
          if (idx < rule.days.length) {
            multiDayDayIndex.set(e.id, idx);
            multiDayRuleAssignment.set(e.id, rule);
          }
        }
      });
    }
  }

  const proposals: Proposal[] = [];

  for (const e of allEvents) {
    const reasons: string[] = [];
    let newName = e.event_name;
    let newCity = e.city;
    let newState = e.state;
    let newStart = e.start_time;
    let newEnd = e.end_time;
    let newSetup = e.setup_time;

    // 1. Name merge
    const merge = mergeLookup.get(normalizeName(e.event_name));
    if (merge && merge !== e.event_name) {
      newName = merge;
      reasons.push("NAME_MERGE");
    }

    // 2. Multi-day rule (takes precedence over single-shift venue
    // rule when both would match — multi-day is more specific).
    const multiRule = multiDayRuleAssignment.get(e.id);
    if (multiRule) {
      const idx = multiDayDayIndex.get(e.id)!;
      const day = multiRule.days[idx];
      if (!timeMatches(e.start_time, day.start)) {
        newStart = day.start + ":00";
        reasons.push(`MULTI_DAY_${multiRule.label.toUpperCase().replace(/\s+/g, "_")}_DAY${idx + 1}_START`);
      }
      if (!timeMatches(e.end_time, day.end)) {
        newEnd = day.end + ":00";
        reasons.push(`MULTI_DAY_END`);
      }
      if (!timeMatches(e.setup_time, day.setup)) {
        newSetup = day.setup + ":00";
        reasons.push(`MULTI_DAY_SETUP`);
      }
    } else {
      // 3. Single-shift venue time rule
      const venueRule = VENUE_TIME_RULES.find((r) => r.pattern.test(e.event_name));
      if (venueRule) {
        if (!timeMatches(e.start_time, venueRule.start)) {
          newStart = venueRule.start + ":00";
          reasons.push(`TIME_FILL_${venueRule.label.toUpperCase().replace(/[\s()]+/g, "_")}_START`);
        }
        if (!timeMatches(e.end_time, venueRule.end)) {
          newEnd = venueRule.end + ":00";
          reasons.push("TIME_FILL_END");
        }
        if (!timeMatches(e.setup_time, venueRule.setup)) {
          newSetup = venueRule.setup + ":00";
          reasons.push("TIME_FILL_SETUP");
        }
      }
    }

    // 4. Venue location backfill (Millipond Brewing → Millstadt IL)
    const locBackfill = VENUE_LOCATION_BACKFILLS.find((r) => r.pattern.test(e.event_name));
    if (locBackfill) {
      if (!e.city || e.city.trim() === "") {
        newCity = locBackfill.city;
        reasons.push("VENUE_CITY_BACKFILL");
      }
      if (!e.state || e.state.trim() === "") {
        newState = locBackfill.state;
        reasons.push("VENUE_STATE_BACKFILL");
      }
    }

    if (reasons.length === 0) continue;

    proposals.push({
      eventId: e.id,
      eventDate: e.event_date,
      oldName: e.event_name,
      newName,
      oldCity: e.city,
      newCity,
      oldState: e.state,
      newState,
      oldStart: e.start_time,
      newStart,
      oldEnd: e.end_time,
      newEnd,
      oldSetup: e.setup_time,
      newSetup,
      reason: reasons.join(","),
    });
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`PROPOSED CHANGES — ${proposals.length} events`);
  console.log("=".repeat(74));

  // Counts by category.
  const cats = {
    NAME_MERGE: 0,
    TIME_FILL: 0,
    MULTI_DAY: 0,
    VENUE_CITY_BACKFILL: 0,
    VENUE_STATE_BACKFILL: 0,
  };
  for (const p of proposals) {
    if (p.reason.includes("NAME_MERGE")) cats.NAME_MERGE++;
    if (p.reason.includes("TIME_FILL")) cats.TIME_FILL++;
    if (p.reason.includes("MULTI_DAY")) cats.MULTI_DAY++;
    if (p.reason.includes("VENUE_CITY_BACKFILL")) cats.VENUE_CITY_BACKFILL++;
    if (p.reason.includes("VENUE_STATE_BACKFILL")) cats.VENUE_STATE_BACKFILL++;
  }
  for (const [k, v] of Object.entries(cats)) console.log(`  ${k.padEnd(28)} ${v}`);

  // Per-venue rollup (which rule fired most).
  console.log(`\nBy rule:`);
  const ruleCounts: Record<string, number> = {};
  for (const r of NAME_MERGES) ruleCounts[`name: ${r.to}`] = 0;
  for (const r of VENUE_TIME_RULES) ruleCounts[`time: ${r.label}`] = 0;
  for (const r of MULTI_DAY_RULES) ruleCounts[`multi: ${r.label}`] = 0;
  for (const r of VENUE_LOCATION_BACKFILLS) ruleCounts[`loc: ${r.pattern.source}`] = 0;
  for (const p of proposals) {
    if (p.reason.includes("NAME_MERGE")) ruleCounts[`name: ${p.newName}`]++;
    for (const r of VENUE_TIME_RULES) {
      if (r.pattern.test(p.oldName) || r.pattern.test(p.newName)) {
        if (p.reason.includes("TIME_FILL")) ruleCounts[`time: ${r.label}`]++;
      }
    }
    for (const r of MULTI_DAY_RULES) {
      if (r.pattern.test(p.oldName) || r.pattern.test(p.newName)) {
        if (p.reason.includes("MULTI_DAY")) ruleCounts[`multi: ${r.label}`]++;
      }
    }
  }
  for (const [k, v] of Object.entries(ruleCounts)) {
    if (v > 0) console.log(`  ${k.padEnd(50)} ${v}`);
  }

  // Sample.
  console.log(`\n--- Sample 25 proposals ---`);
  for (const p of proposals.slice(0, 25)) {
    const summary: string[] = [];
    if (p.oldName !== p.newName) summary.push(`name "${p.oldName}" → "${p.newName}"`);
    if (p.oldCity !== p.newCity) summary.push(`city → ${p.newCity ?? "null"}`);
    if (p.oldState !== p.newState) summary.push(`state → ${p.newState ?? "null"}`);
    if (p.oldStart !== p.newStart) summary.push(`start ${p.oldStart ?? "null"} → ${p.newStart}`);
    if (p.oldEnd !== p.newEnd) summary.push(`end → ${p.newEnd}`);
    if (p.oldSetup !== p.newSetup) summary.push(`setup → ${p.newSetup}`);
    console.log(`  ${p.eventDate}  ${summary.join(" | ").slice(0, 120)}`);
  }

  // TSV.
  const headers = [
    "event_id", "event_date", "old_name", "new_name", "old_city", "new_city",
    "old_state", "new_state", "old_start", "new_start", "old_end", "new_end",
    "old_setup", "new_setup", "reason",
  ];
  const lines = [
    headers.join("\t"),
    ...proposals.map((p) =>
      [
        p.eventId, p.eventDate, p.oldName, p.newName,
        p.oldCity ?? "", p.newCity ?? "",
        p.oldState ?? "", p.newState ?? "",
        p.oldStart ?? "", p.newStart ?? "",
        p.oldEnd ?? "", p.newEnd ?? "",
        p.oldSetup ?? "", p.newSetup ?? "",
        p.reason,
      ].map((v) => String(v).replace(/\t/g, " ")).join("\t")
    ),
  ];
  writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nFull TSV: ${outputPath}`);

  if (!apply) {
    console.log(`\nDRY RUN — no records modified. --apply to write.`);
    return;
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`APPLYING ${proposals.length} CHANGES`);
  console.log("=".repeat(74));

  let updated = 0;
  let failed = 0;
  for (const p of proposals) {
    const update: Record<string, unknown> = {};
    if (p.oldName !== p.newName) update.event_name = p.newName;
    if (p.oldCity !== p.newCity) update.city = p.newCity;
    if (p.oldState !== p.newState) update.state = p.newState;
    if (p.oldStart !== p.newStart) update.start_time = p.newStart;
    if (p.oldEnd !== p.newEnd) update.end_time = p.newEnd;
    if (p.oldSetup !== p.newSetup) update.setup_time = p.newSetup;
    if (Object.keys(update).length === 0) continue;
    const { error: upErr } = await supabase
      .from("events")
      .update(update)
      .eq("id", p.eventId)
      .eq("user_id", userId);
    if (upErr) {
      console.error(`  FAILED ${p.eventId}: ${upErr.message}`);
      failed++;
    } else {
      updated++;
    }
  }
  console.log(`\nUpdated: ${updated}  Failed: ${failed}`);
}
