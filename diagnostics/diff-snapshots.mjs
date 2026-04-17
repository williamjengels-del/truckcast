// Compare two confidence snapshots and print a before/after report.
// Usage: node diagnostics/diff-snapshots.mjs <before.json> <after.json>

import { readFileSync } from "node:fs";

const [, , beforePath, afterPath] = process.argv;
if (!beforePath || !afterPath) {
  console.error("Usage: node diagnostics/diff-snapshots.mjs <before.json> <after.json>");
  process.exit(1);
}

const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));

const byKey = (snapshot) => {
  const map = new Map();
  for (const row of snapshot.rows) {
    map.set(`${row.date}|${row.name}`, row);
  }
  return map;
};

const beforeMap = byKey(before);
const afterMap = byKey(after);

console.log(`# Before vs After — Commit 1 scoring diff`);
console.log(`Before: ${beforePath}  (${before.runAt})`);
console.log(`After:  ${afterPath}  (${after.runAt})`);
console.log("");
console.log(`Label distribution:`);
console.log(`  Before → ${JSON.stringify(before.labelDistribution)}`);
console.log(`  After  → ${JSON.stringify(after.labelDistribution)}`);
console.log("");
console.log(`Venue-familiarity firing: ${before.venueFamiliarityFiringCount}/${before.upcomingCount} → ${after.venueFamiliarityFiringCount}/${after.upcomingCount}`);
console.log("");

const rows = [];
for (const [key, b] of beforeMap) {
  const a = afterMap.get(key);
  if (!a) {
    rows.push({ key, name: b.name, date: b.date, note: "DISAPPEARED in after" });
    continue;
  }
  rows.push({
    key,
    date: b.date,
    name: b.name,
    level: `${b.level}→${a.level}`,
    totalBefore: b.total,
    totalAfter: a.total,
    delta: a.total != null && b.total != null ? (a.total - b.total) : null,
    labelBefore: b.label,
    labelAfter: a.label,
    labelChanged: b.label !== a.label,
    tierBefore: b.components?.tier ?? 0,
    tierAfter: a.components?.tier ?? 0,
    venueBefore: b.components?.venue ?? 0,
    venueAfter: a.components?.venue ?? 0,
  });
}

rows.sort((x, y) => (y.delta ?? -Infinity) - (x.delta ?? -Infinity));

console.log(`| # | Date | Event | Lvl | Tier Δ | Venue Δ | Total: Before → After (Δ) | Label change |`);
console.log(`|---|------|-------|-----|--------|---------|---------------------------|--------------|`);
rows.forEach((r, i) => {
  const tierDelta = (r.tierAfter - r.tierBefore).toFixed(2);
  const venueDelta = (r.venueAfter - r.venueBefore).toFixed(2);
  const totalFmt = r.totalBefore != null && r.totalAfter != null
    ? `${r.totalBefore.toFixed(2)} → ${r.totalAfter.toFixed(2)}  (${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)})`
    : "—";
  const labelChange = r.labelChanged ? `**${r.labelBefore} → ${r.labelAfter}**` : r.labelBefore;
  const truncName = r.name.length > 30 ? r.name.slice(0, 29) + "…" : r.name;
  console.log(`| ${i + 1} | ${r.date} | ${truncName} | ${r.level} | ${tierDelta === "0.00" ? "—" : (r.tierAfter - r.tierBefore >= 0 ? "+" : "") + tierDelta} | ${venueDelta === "0.00" ? "—" : (r.venueAfter - r.venueBefore >= 0 ? "+" : "") + venueDelta} | ${totalFmt} | ${labelChange} |`);
});

const flipped = rows.filter((r) => r.labelChanged);
console.log("");
console.log(`## Label changes: ${flipped.length}`);
for (const r of flipped) {
  console.log(`- ${r.date}  "${r.name}":  ${r.labelBefore} → ${r.labelAfter}  (total ${r.totalBefore.toFixed(2)} → ${r.totalAfter.toFixed(2)})`);
}
