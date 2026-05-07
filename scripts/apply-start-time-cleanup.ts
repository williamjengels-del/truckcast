#!/usr/bin/env node
// Apply venue-rule-based fixes to event start_time / end_time / setup_time.
//
// Rules from operator's memory entry (project_woko_venue_time_rules.md,
// confirmed 2026-05-07, all times CST). General rule: setup is 1 hour
// before start_time unless specified.
//
//   Charter St. Ann          — setup 10:30, start 11:00, end 13:30
//   Charter Town and Country — setup 10:30, start 11:00, end 13:30
//   9 Mile Garden            — three valid shifts:
//                                evening (start 16:30, end 21:00)
//                                day     (start 10:00, end 16:00)
//                                full    (start 10:00, end 21:00)
//   Lunch on the Landing     — start 11:00, end 13:00
//   Mercy Hospital Dinner    — start 18:00, end 23:00
//   Laumeier Fridays         — start 16:00, end 20:00
//   Finally Friday           — start 16:00, end 20:00
//
// What this script does:
//   - For events at the rule venues, identifies any whose start_time
//     deviates from the valid shifts. For 9 Mile Garden, "deviates"
//     means it doesn't fall within ±30min of any of the three valid
//     starts.
//   - For the 9 Mile Garden 04:30 / 05:30 cluster (the AM/PM-flip
//     pattern from the Airtable destruction): propose start+12 hours
//     (04:30 → 16:30, 05:30 → 17:30 then snap to nearest valid 16:30).
//   - Proposes corrected end_time + setup_time per the rule.
//   - Does NOT touch events that already have valid times.
//   - Does NOT default NULL start_times — operator decides those
//     case-by-case (deferred to deep-debug).
//
// Dry-run by default. Pass --apply to write. Per the no-auto-fix rule,
// the operator confirms the dry-run before --apply runs.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/apply-start-time-cleanup.ts <user-id>           # dry-run
//   npx tsx scripts/apply-start-time-cleanup.ts <user-id> --apply   # writes
//
// Output TSV: ./start-time-cleanup-proposals.tsv

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const apply = process.argv.includes("--apply");
const outputPath = "./start-time-cleanup-proposals.tsv";

if (!userId) {
  console.error("Usage: npx tsx scripts/apply-start-time-cleanup.ts <user-id> [--apply]");
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

interface Shift {
  start: string; // HH:MM
  end: string;
  setup: string;
}

interface VenueRule {
  /** Match event_name against this regex (case-insensitive). */
  pattern: RegExp;
  /** All valid shifts. The proposed-fix logic picks the shift whose
   *  start_time is closest to the (possibly AM/PM-flipped) current
   *  start. */
  shifts: Shift[];
  /** Display label for the TSV. */
  label: string;
}

const VENUE_RULES: VenueRule[] = [
  {
    pattern: /^charter\s+(st\.?\s*ann|town\s*(and|&)\s*country)/i,
    shifts: [{ start: "11:00", end: "13:30", setup: "10:30" }],
    label: "Charter (St Ann / Town and Country)",
  },
  {
    pattern: /^9\s*mile\s*garden/i,
    shifts: [
      { start: "16:30", end: "21:00", setup: "15:30" },
      { start: "10:00", end: "16:00", setup: "09:00" },
      { start: "10:00", end: "21:00", setup: "09:00" },
    ],
    label: "9 Mile Garden",
  },
  {
    pattern: /^lunch\s+on\s+the\s+landing/i,
    shifts: [{ start: "11:00", end: "13:00", setup: "10:00" }],
    label: "Lunch on the Landing",
  },
  {
    pattern: /^mercy\s+hospital.*dinner/i,
    shifts: [{ start: "18:00", end: "23:00", setup: "17:00" }],
    label: "Mercy Hospital Dinner",
  },
  {
    pattern: /^(laumeier\s+fridays?|finally\s+friday)/i,
    shifts: [{ start: "16:00", end: "20:00", setup: "15:00" }],
    label: "Laumeier / Finally Friday",
  },
];

/** Parse "HH:MM:SS" or "HH:MM" to minutes-since-midnight. Null on failure. */
function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

interface Proposal {
  eventId: string;
  eventDate: string;
  eventName: string;
  venueLabel: string;
  oldStart: string | null;
  newStart: string;
  oldEnd: string | null;
  newEnd: string;
  oldSetup: string | null;
  newSetup: string;
  reason: string;
}

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("id, event_date, event_name, start_time, end_time, setup_time")
    .eq("user_id", userId);
  if (error) throw error;
  const allEvents = (data ?? []) as Pick<
    Event,
    "id" | "event_date" | "event_name" | "start_time" | "end_time" | "setup_time"
  >[];

  console.log(`\nTotal events: ${allEvents.length}`);

  const proposals: Proposal[] = [];

  for (const e of allEvents) {
    // Find matching venue rule (first match wins; rules are mutually
    // exclusive in practice).
    const rule = VENUE_RULES.find((r) => r.pattern.test(e.event_name));
    if (!rule) continue;

    const startMin = timeToMinutes(e.start_time);

    // Skip when start_time is already valid (within ±30min of any shift's start).
    if (startMin !== null) {
      const matchedShift = rule.shifts.find(
        (s) => Math.abs(timeToMinutes(s.start)! - startMin) <= 30
      );
      if (matchedShift) continue;
    }

    // Pick the proposed shift. Strategy (operator rule confirmed
    // 2026-05-07: "we never have events at 4:30am or 5:30am, or
    // anytime that seems unusual like that. Except some late night
    // events that go past midnight"):
    //
    //   1. If start_time looks like an unusual AM time (before 08:00),
    //      treat it as an AM/PM flip — add 12 hours then snap to the
    //      nearest valid shift. Catches both the 04:30 cluster
    //      (flipped → 16:30, exact shift match) and the 05:30 case
    //      (flipped → 17:30, snap to 16:30 evening shift).
    //   2. Otherwise (08:00+), snap to nearest valid shift directly.
    //      11:00 → 10:00 morning shift, etc.
    let proposedShift: Shift = rule.shifts[0];
    let reason = "VENUE_RULE_DEFAULT";

    if (startMin !== null) {
      const lookupTime = startMin < 8 * 60 ? (startMin + 12 * 60) % (24 * 60) : startMin;
      const wasFlipped = lookupTime !== startMin;
      // Snap to nearest shift by start-time distance.
      let closest = rule.shifts[0];
      let bestDist = Infinity;
      for (const s of rule.shifts) {
        const d = Math.abs(timeToMinutes(s.start)! - lookupTime);
        if (d < bestDist) {
          bestDist = d;
          closest = s;
        }
      }
      proposedShift = closest;
      reason = wasFlipped ? "AM_PM_FLIP" : "VENUE_RULE_NEAREST";
    } else {
      // Don't propose a fix for NULL start_time per the rule's
      // deferral. Skip entirely.
      continue;
    }

    proposals.push({
      eventId: e.id,
      eventDate: e.event_date,
      eventName: e.event_name,
      venueLabel: rule.label,
      oldStart: e.start_time,
      newStart: minutesToTime(timeToMinutes(proposedShift.start)!),
      oldEnd: e.end_time,
      newEnd: minutesToTime(timeToMinutes(proposedShift.end)!),
      oldSetup: e.setup_time,
      newSetup: minutesToTime(timeToMinutes(proposedShift.setup)!),
      reason,
    });
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`PROPOSED START_TIME FIXES — ${proposals.length} events`);
  console.log("=".repeat(74));
  const reasonCounts: Record<string, number> = {};
  const venueCounts: Record<string, number> = {};
  for (const p of proposals) {
    reasonCounts[p.reason] = (reasonCounts[p.reason] ?? 0) + 1;
    venueCounts[p.venueLabel] = (venueCounts[p.venueLabel] ?? 0) + 1;
  }
  console.log(`\nBy reason:`);
  for (const [r, c] of Object.entries(reasonCounts)) console.log(`  ${r.padEnd(25)} ${c}`);
  console.log(`\nBy venue:`);
  for (const [v, c] of Object.entries(venueCounts)) console.log(`  ${v.padEnd(40)} ${c}`);

  console.log(`\n--- Sample proposals ---`);
  for (const p of proposals.slice(0, 30)) {
    console.log(
      `  ${p.eventDate}  ${(p.oldStart ?? "(null)").padEnd(9)} → ${p.newStart}  [${p.reason}]  ${p.venueLabel}  | ${p.eventName.slice(0, 40)}`
    );
  }

  // Write TSV.
  const headers = [
    "event_id",
    "event_date",
    "event_name",
    "venue_rule",
    "old_start",
    "new_start",
    "old_end",
    "new_end",
    "old_setup",
    "new_setup",
    "reason",
  ];
  const lines = [
    headers.join("\t"),
    ...proposals.map((p) =>
      [
        p.eventId,
        p.eventDate,
        p.eventName,
        p.venueLabel,
        p.oldStart ?? "",
        p.newStart,
        p.oldEnd ?? "",
        p.newEnd,
        p.oldSetup ?? "",
        p.newSetup,
        p.reason,
      ]
        .map((v) => String(v).replace(/\t/g, " "))
        .join("\t")
    ),
  ];
  writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nFull TSV written to ${outputPath}`);

  if (!apply) {
    console.log(`\n${"=".repeat(74)}`);
    console.log("DRY RUN — no records modified.");
    console.log("Review the TSV. Re-run with --apply to write.");
    console.log("=".repeat(74));
    return;
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`APPLYING ${proposals.length} CHANGES`);
  console.log("=".repeat(74));

  let updated = 0;
  let failed = 0;
  for (const p of proposals) {
    const update: Record<string, unknown> = {
      start_time: p.newStart,
      end_time: p.newEnd,
      setup_time: p.newSetup,
    };
    const { error: upErr } = await supabase
      .from("events")
      .update(update)
      .eq("id", p.eventId)
      .eq("user_id", userId);
    if (upErr) {
      console.error(`  FAILED ${p.eventId} (${p.eventName}): ${upErr.message}`);
      failed++;
    } else {
      updated++;
    }
  }
  console.log(`\nUpdated: ${updated}  Failed: ${failed}`);
}
