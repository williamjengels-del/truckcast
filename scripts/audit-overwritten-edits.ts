#!/usr/bin/env node
// Read-only audit for events whose stored net_sales likely doesn't
// reflect the operator's true canonical value — i.e., rows where an
// earlier manual edit was silently overwritten by a POS sync.
//
// Why this exists: the form-edit path used to write net_sales without
// flipping pos_source to "manual", which left rows tagged "square" /
// "toast" / "mixed" and re-eligible for the shared POS sync to
// overwrite. Fix shipped 2026-05-12 in
// src/app/dashboard/events/actions.ts. This audit surfaces rows that
// may have been blown away before the fix landed, so the operator can
// re-enter the correct value via the UI (which now claims pos_source
// for them).
//
// Read-only. Service-role client. Outputs TSV to stdout.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/audit-overwritten-edits.ts <user-id> > overwritten-audit.tsv
//
// Signal categories (column 9, sorted strong → weak):
//   HIGH_BELOW_MIN      sales_minimum > 0 AND net_sales < sales_minimum
//                       AND pos_source != "manual". The contract floor
//                       says payout was at least $X, but storage shows
//                       less. Strong overwrite candidate.
//   HIGH_FIXED_REV      fee_type in pre_settled / commission_with_minimum
//                       and pos_source != "manual". These events have
//                       a contracted/invoiced revenue that POS data
//                       structurally can't capture — overwrite by a
//                       POS slice is wrong by construction.
//   HIGH_INVOICE_REV    invoice_revenue > 0 (catering invoice present)
//                       AND pos_source != "manual". Same logic.
//   MED_SAME_DAY_SPLIT  Multiple booked events same date, all with
//                       pos_source != "manual". The POS sync's split-
//                       across-siblings logic divides the day's
//                       aggregate by forecast — the per-row number
//                       may not be the actual per-event sales.
//   LOW_POS_PAST        Past event with net_sales > 0 and pos_source
//                       in (square, toast, mixed). Broad catch-all
//                       for "the operator may have edited this and
//                       it got reverted." Worth a skim, not a hard
//                       action item.
//
// Operator decides per row (per feedback_no_auto_fix_data). No apply
// script — operator re-enters via the UI, which post-fix flips
// pos_source to "manual" and protects the row going forward.

import { createClient } from "@supabase/supabase-js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/audit-overwritten-edits.ts <user-id>");
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

interface EventRow {
  id: string;
  event_date: string;
  event_name: string;
  net_sales: number | null;
  invoice_revenue: number | null;
  pos_source: string | null;
  fee_type: string | null;
  sales_minimum: number | null;
  fee_rate: number | null;
  event_mode: string | null;
  location: string | null;
  city: string | null;
  booked: boolean;
  anomaly_flag: string | null;
  updated_at: string | null;
}

const today = new Date().toISOString().slice(0, 10);

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, event_date, event_name, net_sales, invoice_revenue, pos_source, fee_type, sales_minimum, fee_rate, event_mode, location, city, booked, anomaly_flag, updated_at"
    )
    .eq("user_id", userId)
    .order("event_date", { ascending: true });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  const events = (data ?? []) as EventRow[];

  // Group by date for the same-day-split signal
  const byDate = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!byDate.has(e.event_date)) byDate.set(e.event_date, []);
    byDate.get(e.event_date)!.push(e);
  }

  const flagged: Array<{ event: EventRow; category: string; reason: string }> = [];

  for (const e of events) {
    // Skip future + cancelled / disrupted
    if (e.event_date >= today) continue;
    if (e.anomaly_flag === "disrupted") continue;
    if (!e.booked) continue;

    const sourceIsPos =
      e.pos_source === "square" ||
      e.pos_source === "toast" ||
      e.pos_source === "mixed" ||
      e.pos_source === "clover" ||
      e.pos_source === "sumup";

    // HIGH_BELOW_MIN — contracted floor not reflected
    if (
      sourceIsPos &&
      (e.sales_minimum ?? 0) > 0 &&
      (e.net_sales ?? 0) < (e.sales_minimum ?? 0)
    ) {
      flagged.push({
        event: e,
        category: "HIGH_BELOW_MIN",
        reason: `sales_minimum=$${e.sales_minimum} but net_sales=$${e.net_sales ?? 0}`,
      });
      continue; // most specific wins
    }

    // HIGH_FIXED_REV — contracted/invoiced revenue path with POS source
    if (
      sourceIsPos &&
      (e.fee_type === "pre_settled" ||
        e.fee_type === "commission_with_minimum")
    ) {
      flagged.push({
        event: e,
        category: "HIGH_FIXED_REV",
        reason: `fee_type=${e.fee_type} with pos_source=${e.pos_source}`,
      });
      continue;
    }

    // HIGH_INVOICE_REV — catering with invoice, POS-tagged
    if (sourceIsPos && (e.invoice_revenue ?? 0) > 0) {
      flagged.push({
        event: e,
        category: "HIGH_INVOICE_REV",
        reason: `invoice_revenue=$${e.invoice_revenue} with pos_source=${e.pos_source}`,
      });
      continue;
    }

    // MED_SAME_DAY_SPLIT — siblings all POS-tagged on same date
    const siblings = byDate.get(e.event_date) ?? [];
    const bookedSiblings = siblings.filter((s) => s.booked && s.anomaly_flag !== "disrupted");
    if (bookedSiblings.length >= 2) {
      const allPos = bookedSiblings.every(
        (s) =>
          s.pos_source === "square" ||
          s.pos_source === "toast" ||
          s.pos_source === "mixed" ||
          s.pos_source === "clover" ||
          s.pos_source === "sumup"
      );
      if (allPos && sourceIsPos) {
        flagged.push({
          event: e,
          category: "MED_SAME_DAY_SPLIT",
          reason: `${bookedSiblings.length} booked siblings same day, all pos_source != manual`,
        });
        continue;
      }
    }

    // LOW_POS_PAST — broad catch-all: past + booked + POS source + has sales
    if (sourceIsPos && (e.net_sales ?? 0) > 0) {
      flagged.push({
        event: e,
        category: "LOW_POS_PAST",
        reason: `pos_source=${e.pos_source} on past booked event with net_sales=$${e.net_sales}`,
      });
    }
  }

  // Sort: HIGH_* first, then MED, then LOW; within category, date asc
  const rank = (c: string) =>
    c.startsWith("HIGH_") ? 0 : c.startsWith("MED_") ? 1 : 2;
  flagged.sort((a, b) => {
    const r = rank(a.category) - rank(b.category);
    if (r !== 0) return r;
    return a.event.event_date.localeCompare(b.event.event_date);
  });

  // TSV header
  process.stdout.write(
    [
      "event_date",
      "event_name",
      "net_sales",
      "invoice_revenue",
      "pos_source",
      "fee_type",
      "sales_minimum",
      "location_or_city",
      "category",
      "reason",
      "same_day_siblings",
      "event_id",
    ].join("\t") + "\n"
  );

  for (const { event: e, category, reason } of flagged) {
    // Same-day siblings (other booked events on the same date, with
    // their current net_sales + pos_source). Operator uses this to see
    // what shared the Square / Toast split — e.g., Music Park 4/25 +
    // Shutterfest 4/25 both got divided from a single day's aggregate.
    const siblings = (byDate.get(e.event_date) ?? [])
      .filter((s) => s.id !== e.id && s.booked && s.anomaly_flag !== "disrupted")
      .map(
        (s) =>
          `${s.event_name} ($${s.net_sales ?? 0}, ${s.pos_source ?? "—"})`
      )
      .join(" | ") || "—";

    process.stdout.write(
      [
        e.event_date,
        e.event_name,
        e.net_sales ?? "",
        e.invoice_revenue ?? "",
        e.pos_source ?? "",
        e.fee_type ?? "",
        e.sales_minimum ?? "",
        e.location ?? e.city ?? "",
        category,
        reason,
        siblings,
        e.id,
      ]
        .map((v) => String(v).replace(/\t/g, " ").replace(/\n/g, " "))
        .join("\t") + "\n"
    );
  }

  // Footer summary to stderr so stdout is clean TSV
  const counts: Record<string, number> = {};
  for (const f of flagged) counts[f.category] = (counts[f.category] ?? 0) + 1;
  console.error(`\nFlagged ${flagged.length} rows:`);
  for (const k of Object.keys(counts).sort()) {
    console.error(`  ${k}: ${counts[k]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
