#!/usr/bin/env node
// Operator diagnostic: list POS connections whose last sync is older
// than expected. Would've surfaced the 2026-04-19 Toast Worker SPF
// silent-data-loss bug automatically — Toast connections show
// last_sync_at = old while Square/Clover stay current, so the
// discrepancy is obvious in this report.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/diagnose-stale-pos-syncs.mjs [days-threshold]
//
// Defaults to 2 days (48h). Override with first arg:
//   node scripts/diagnose-stale-pos-syncs.mjs 7
//
// Exit codes:
//   0 — no stale connections found (or all within threshold)
//   1 — at least one connection exceeds the critical threshold (7 days)
//   2 — env var / connectivity failure
//
// Read-only: SELECT queries only, no writes. Safe to run against prod.

import { createClient } from "@supabase/supabase-js";

const DAYS_WARN = Number.parseFloat(process.argv[2] ?? "2");
const DAYS_CRITICAL = 7;

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

const { data: connections, error } = await supabase
  .from("pos_connections")
  .select(
    "user_id, provider, last_sync_at, last_sync_status, last_sync_error, sync_enabled, profiles(business_name)"
  )
  .eq("sync_enabled", true)
  .order("last_sync_at", { ascending: true, nullsFirst: true });

if (error) {
  console.error("Supabase query failed:", error.message);
  process.exit(2);
}

const now = Date.now();
const rows = (connections ?? []).map((c) => {
  const lastSyncMs = c.last_sync_at ? Date.parse(c.last_sync_at) : null;
  const daysSince = lastSyncMs ? (now - lastSyncMs) / (1000 * 60 * 60 * 24) : Infinity;
  return {
    provider: c.provider,
    business: c.profiles?.business_name ?? "(no name)",
    userId: c.user_id.slice(0, 8),
    lastSyncAt: c.last_sync_at ?? "never",
    daysSince,
    status: c.last_sync_status,
    error: c.last_sync_error,
  };
});

// Severity partition
const critical = rows.filter((r) => r.daysSince > DAYS_CRITICAL);
const warning = rows.filter((r) => r.daysSince > DAYS_WARN && r.daysSince <= DAYS_CRITICAL);
const ok = rows.filter((r) => r.daysSince <= DAYS_WARN);

function fmtDays(d) {
  if (d === Infinity) return "never";
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${d.toFixed(1)}d`;
}

function printSection(label, items, color) {
  if (items.length === 0) return;
  const reset = "\x1b[0m";
  const head = `${color}${label}${reset}`;
  console.log(`\n${head}  (${items.length})`);
  for (const r of items) {
    const errSuffix = r.error ? `  err="${r.error.slice(0, 80)}"` : "";
    console.log(
      `  ${r.provider.padEnd(7)} ${r.business.padEnd(25)} ${r.userId}… ` +
        `last=${fmtDays(r.daysSince).padStart(6)}  status=${r.status}${errSuffix}`
    );
  }
}

console.log(
  `POS sync freshness report — threshold warn>${DAYS_WARN}d, critical>${DAYS_CRITICAL}d`
);
console.log(`Total enabled connections: ${rows.length}`);

printSection("CRITICAL — stale > 7 days", critical, "\x1b[31m"); // red
printSection("WARN — stale > threshold", warning, "\x1b[33m"); // yellow
printSection("OK — within threshold", ok, "\x1b[32m"); // green

console.log("");
if (critical.length > 0) {
  console.log(`FAIL: ${critical.length} connection(s) critically stale.`);
  process.exit(1);
}
if (warning.length > 0) {
  console.log(`WARN: ${warning.length} connection(s) above threshold but not critical.`);
}
console.log("Done.");
process.exit(0);
