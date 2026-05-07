#!/usr/bin/env node
// Backfill state and canonicalize city for existing events.
//
// Three classes of fix surfaced by the 2026-05-07 weather-location audit:
//
//   1. CITY_HAS_STATE_SUFFIX — city contains a trailing state like
//      "Saint Louis Mo" or "Chesterfield, Mo 63005". Extract the state
//      into the state column; canonical city becomes "Saint Louis" /
//      "Chesterfield".
//
//   2. CITY_CASING — canonicalizeCity output differs from stored value
//      (most commonly "O'fallon" → "O'Fallon" after the apostrophe-
//      preservation fix in PR #221).
//
//   3. STATE_DEFAULT — event has a city but state is still NULL after
//      the suffix-extraction pass. Default to the operator's profile
//      state per the rule confirmed by Julian 2026-05-07: "all events
//      should default to whatever state the operator chose. If I have
//      an event in another state, I go in and change it manually."
//
// Dry-run by default. Writes a TSV showing every proposed change.
// Pass --apply to actually update the events table. Per the no-auto-
// fix rule (memory: feedback_no_auto_fix_data), the operator confirms
// the dry-run TSV before --apply runs.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/apply-state-city-backfill.ts <user-id>           # dry-run
//   npx tsx scripts/apply-state-city-backfill.ts <user-id> --apply   # writes
//
// Output TSV: ./state-city-backfill-proposals.tsv

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import {
  canonicalizeCityAndState,
  normalizeStateCode,
} from "../src/lib/city-normalize.ts";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const apply = process.argv.includes("--apply");
const outputPath = "./state-city-backfill-proposals.tsv";

if (!userId) {
  console.error("Usage: npx tsx scripts/apply-state-city-backfill.ts <user-id> [--apply]");
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

interface Proposal {
  eventId: string;
  eventDate: string;
  eventName: string;
  oldCity: string | null;
  newCity: string | null;
  oldState: string | null;
  newState: string | null;
  reason: string;
}

// City-specific state overrides for Wok-O Taco's footprint.
//
// Belleville: Scott AFB territory — operator confirmed 2026-05-07 all
// 50 of their Belleville events are IL (Scott Air Force Base in
// Belleville, IL). Override the default-to-MO behavior for this city.
//
// Cities NOT in this map fall through to the operator's profile-state
// default (MO) per the standing rule. O'Fallon stays MO per
// operator's explicit confirmation 2026-05-07: "All of those you
// listed should be MO" (referring to the 17 O'Fallon events).
const CITY_STATE_OVERRIDES = new Map<string, string>([
  ["belleville", "IL"],
]);

// Cities in Wok-O Taco's footprint that have known cross-state
// ambiguity but stay on the operator default unless explicitly
// overridden above. Used to flag CROSS_STATE_RISK in the TSV so the
// post-apply review is targeted to events that didn't get an
// override. Currently O'Fallon — exists in both MO and IL but the
// operator's pattern is mostly MO.
const KNOWN_IL_CITIES = new Set([
  "belleville",
  "madison",
  "alton",
  "edwardsville",
  "godfrey",
  "millstadt",
  "troy",
  "shiloh",
  "fairview heights",
  "granite city",
  "collinsville",
  "o'fallon",
]);

// Normalize an empty string to null so we don't propose vacuous
// "" → null changes (functionally equivalent in our schema).
function nullIfEmpty(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}

async function main() {
  // Load operator's profile state for the STATE_DEFAULT case.
  const { data: profile } = await supabase
    .from("profiles")
    .select("state")
    .eq("id", userId)
    .maybeSingle();
  const profileState = normalizeStateCode((profile as { state?: string } | null)?.state ?? null);
  console.log(`\nOperator profile state: ${profileState ?? "(none set)"}`);

  // Load all events.
  const { data, error } = await supabase
    .from("events")
    .select("id, event_date, event_name, city, state")
    .eq("user_id", userId);
  if (error) throw error;
  const allEvents = (data ?? []) as Pick<Event, "id" | "event_date" | "event_name" | "city" | "state">[];
  console.log(`Total events: ${allEvents.length}\n`);

  const proposals: Proposal[] = [];

  for (const e of allEvents) {
    // Coerce empty strings to null up front so we don't propose
    // cosmetic "" → null changes that are no-ops in our schema.
    const oldCity = nullIfEmpty(e.city);
    const oldState = nullIfEmpty(e.state);

    // Step 1: run the canonical pass on (city, state) — handles suffix
    // extraction and casing normalization (apostrophe + abbreviation).
    const { city: canonCity, state: canonState } = canonicalizeCityAndState(
      oldCity,
      oldState
    );
    let newCity = nullIfEmpty(canonCity);
    let newState: string | null = canonState;

    // Step 2: STATE_DEFAULT — if state is still null after extraction
    // AND the event has a city, default to a city-specific override
    // when one exists (e.g. Belleville → IL for Scott AFB territory),
    // otherwise to the operator's profile state.
    if (!newState && newCity) {
      const cityKey = newCity.toLowerCase();
      const override = CITY_STATE_OVERRIDES.get(cityKey);
      if (override) {
        newState = override;
      } else if (profileState) {
        newState = profileState;
      }
    }

    // Skip if nothing would change (after the empty-string coercion).
    const cityChanged = oldCity !== newCity;
    const stateChanged = oldState !== newState;
    if (!cityChanged && !stateChanged) continue;

    // Classify reason for the TSV.
    const reasons: string[] = [];
    if (cityChanged && oldCity && newCity) {
      if (oldCity.toLowerCase() !== newCity.toLowerCase()) {
        // Lowercase forms differ — content changed. Either suffix
        // stripping (length dropped) or word substitution (e.g.
        // "St." → "Saint"; same length-ish but different content).
        const stripped = oldCity.length > newCity.length + 1;
        reasons.push(stripped ? "CITY_HAS_STATE_SUFFIX" : "CITY_CASING");
      } else {
        // Same lowercase, different mixed case → apostrophe / casing
        // fix (e.g. "O'fallon" → "O'Fallon" from PR #221).
        reasons.push("CITY_CASING");
      }
    } else if (cityChanged && (!oldCity || !newCity)) {
      reasons.push("CITY_NORMALIZED");
    }
    if (stateChanged) {
      const cityKey = newCity?.toLowerCase() ?? "";
      const override = CITY_STATE_OVERRIDES.get(cityKey);
      if (!oldState && newState === canonState && canonState) {
        reasons.push("STATE_FROM_SUFFIX");
      } else if (!oldState && override && newState === override) {
        reasons.push("STATE_CITY_OVERRIDE");
      } else if (!oldState && newState === profileState) {
        reasons.push("STATE_DEFAULT");
      } else {
        reasons.push("STATE_NORMALIZED");
      }
    }

    // Cross-state risk flag: STATE_DEFAULT to operator state, but the
    // city is in the known-IL list (and didn't get an explicit
    // override above). Operator should review post-apply. Override
    // case isn't a risk — it already routes to IL.
    if (
      reasons.includes("STATE_DEFAULT") &&
      newCity &&
      KNOWN_IL_CITIES.has(newCity.toLowerCase()) &&
      newState !== "IL"
    ) {
      reasons.push("CROSS_STATE_RISK");
    }

    proposals.push({
      eventId: e.id,
      eventDate: e.event_date,
      eventName: e.event_name,
      oldCity,
      newCity,
      oldState,
      newState,
      reason: reasons.join(","),
    });
  }

  // Summary by reason.
  const reasonCounts: Record<string, number> = {};
  for (const p of proposals) {
    for (const r of p.reason.split(",")) {
      reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    }
  }
  console.log(`${"=".repeat(70)}`);
  console.log(`PROPOSED CHANGES — ${proposals.length} of ${allEvents.length} events`);
  console.log("=".repeat(70));
  for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(25)} ${count}`);
  }

  // Cross-state risk events listed in full so the operator can plan
  // the post-apply manual review pass.
  const crossStateRisks = proposals.filter((p) => p.reason.includes("CROSS_STATE_RISK"));
  if (crossStateRisks.length > 0) {
    console.log(
      `\n--- ${crossStateRisks.length} CROSS_STATE_RISK events (city is commonly IL — review post-apply) ---`
    );
    for (const p of crossStateRisks) {
      console.log(
        `  ${p.eventDate}  city="${p.newCity}"  proposed_state=MO  ${p.eventName.slice(0, 50)}`
      );
    }
  }

  // Sample of proposals for inline review.
  console.log(`\n--- Sample of 20 proposed changes ---`);
  for (const p of proposals.slice(0, 20)) {
    console.log(
      `  ${p.eventDate}  ` +
        `city: "${p.oldCity ?? ""}" → "${p.newCity ?? ""}"  ` +
        `state: "${p.oldState ?? ""}" → "${p.newState ?? ""}"  ` +
        `[${p.reason}]  ${p.eventName.slice(0, 40)}`
    );
  }

  // Write the full TSV.
  const headers = [
    "event_id",
    "event_date",
    "event_name",
    "old_city",
    "new_city",
    "old_state",
    "new_state",
    "reason",
  ];
  const lines = [
    headers.join("\t"),
    ...proposals.map((p) =>
      [
        p.eventId,
        p.eventDate,
        p.eventName,
        p.oldCity ?? "",
        p.newCity ?? "",
        p.oldState ?? "",
        p.newState ?? "",
        p.reason,
      ]
        .map((v) => String(v).replace(/\t/g, " "))
        .join("\t")
    ),
  ];
  writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nFull TSV written to ${outputPath}`);

  if (!apply) {
    console.log(`\n${"=".repeat(70)}`);
    console.log("DRY RUN — no records modified.");
    console.log("Review the TSV. Re-run with --apply to write changes.");
    console.log("=".repeat(70));
    return;
  }

  // --apply path. Confirm one more time inline.
  console.log(`\n${"=".repeat(70)}`);
  console.log(`APPLYING ${proposals.length} CHANGES — writing to events table now`);
  console.log("=".repeat(70));

  let updated = 0;
  let failed = 0;
  for (const p of proposals) {
    const update: Record<string, unknown> = {};
    if (p.oldCity !== p.newCity) update.city = p.newCity;
    if (p.oldState !== p.newState) update.state = p.newState;
    if (Object.keys(update).length === 0) continue;
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
