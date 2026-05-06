#!/usr/bin/env node
// Operator diagnostic: dump every event for a given user, grouped by
// likely import batch (events created within 60s of each other),
// and surface dates/rows that look orphaned (no source CSV pattern,
// or pos_source = "manual" but bulk-created).
//
// Built to answer Julian's 2026-05-06 ask: "I have dates on VendCast
// that don't match any dates on anything I've imported." Run this,
// then diff the TSV output against the operator's source files
// (Toast CSVs, manual entries, Square sync windows) to find rows
// without an origin.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/audit-events.mjs <user-email-or-user-id>
//
// Output: TSV to stdout — paste into Excel / Sheets for review.
// Columns: event_date, event_name, city, pos_source, booked,
// fee_type, net_sales, forecast_sales, is_sample, created_at,
// import_batch (synthetic group id), id.
//
// Read-only: SELECT queries only, no writes. Safe to run against prod.

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const target = argv[0];

if (!target) {
  console.error(
    "Usage: node scripts/audit-events.mjs <user-email-or-user-id>"
  );
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and " +
      "SUPABASE_SERVICE_ROLE_KEY. Both live in .env.local — export them " +
      "for this shell or prefix the command."
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Resolve user_id — accept either an email (look up in auth.users) or
// a raw UUID (use directly).
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);

let userId;
if (isUuid) {
  userId = target;
} else {
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (authErr) {
    console.error(`Failed to list users: ${authErr.message}`);
    process.exit(2);
  }
  const match = authData?.users?.find(
    (u) => u.email?.toLowerCase() === target.toLowerCase()
  );
  if (!match) {
    console.error(`No user found with email "${target}"`);
    process.exit(2);
  }
  userId = match.id;
  console.error(`# Resolved ${target} -> ${userId}`);
}

// Pull every event for the user.
const { data: events, error } = await supabase
  .from("events")
  .select(
    "id, event_date, event_name, city, location, pos_source, booked, fee_type, net_sales, forecast_sales, is_sample, created_at, event_mode"
  )
  .eq("user_id", userId)
  .order("event_date", { ascending: true });

if (error) {
  console.error(`Query failed: ${error.message}`);
  process.exit(2);
}

if (!events || events.length === 0) {
  console.error(`No events found for user ${userId}`);
  process.exit(0);
}

// Synthetic import-batch grouping: rows with created_at within 60s of
// each other land in the same batch. Useful for distinguishing bulk
// CSV imports from one-off manual entries.
const sortedByCreated = [...events].sort(
  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
);
const batchMap = new Map();
let currentBatch = 0;
let lastTimestamp = 0;
for (const ev of sortedByCreated) {
  const t = new Date(ev.created_at).getTime();
  if (t - lastTimestamp > 60_000) currentBatch += 1;
  batchMap.set(ev.id, currentBatch);
  lastTimestamp = t;
}

// Print TSV header.
console.log(
  [
    "event_date",
    "event_name",
    "city",
    "location",
    "pos_source",
    "event_mode",
    "booked",
    "fee_type",
    "net_sales",
    "forecast_sales",
    "is_sample",
    "created_at",
    "import_batch",
    "id",
  ].join("\t")
);

for (const ev of events) {
  console.log(
    [
      ev.event_date,
      ev.event_name ?? "",
      ev.city ?? "",
      ev.location ?? "",
      ev.pos_source ?? "",
      ev.event_mode ?? "",
      ev.booked ? "true" : "false",
      ev.fee_type ?? "",
      ev.net_sales ?? "",
      ev.forecast_sales ?? "",
      ev.is_sample ? "true" : "false",
      ev.created_at,
      batchMap.get(ev.id) ?? "",
      ev.id,
    ]
      .map((v) => String(v).replace(/\t/g, " ").replace(/\n/g, " "))
      .join("\t")
  );
}

// Footer summary on stderr so it doesn't pollute the TSV.
const counts = events.reduce((acc, ev) => {
  const key = ev.pos_source ?? "(null)";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const dateCounts = events.reduce((acc, ev) => {
  acc[ev.event_date] = (acc[ev.event_date] ?? 0) + 1;
  return acc;
}, {});
const sameDateDuplicates = Object.entries(dateCounts)
  .filter(([, n]) => n > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.error("");
console.error(`# Total events: ${events.length}`);
console.error(`# By pos_source:`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.error(`#   ${k}: ${v}`);
}
console.error(`# Import batches detected (60s grouping): ${currentBatch}`);
console.error(
  `# Dates with multiple events (potential dedupe targets): ${sameDateDuplicates.length}`
);
for (const [date, n] of sameDateDuplicates.slice(0, 30)) {
  console.error(`#   ${date}: ${n} events`);
}
if (sameDateDuplicates.length > 30) {
  console.error(`#   ... ${sameDateDuplicates.length - 30} more`);
}
