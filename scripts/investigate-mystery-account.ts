#!/usr/bin/env node
// Read-only: investigate whether the mystery 4th sharing account is
// a manager belonging to another operator, and whether their events
// overlap with the owner's events (i.e., are they double-counting in
// platform_events aggregates).
//
// Triggered by operator question 2026-05-11 — are the 3-operator
// platform_events buckets actually 2 + a manager?
//
// Usage:
//   npx tsx --env-file=.env.local scripts/investigate-mystery-account.ts <user-id>

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const userId = process.argv[2] ?? "e9f6bf00-8278-47f1-897d-b72d370eb82e";

async function main() {
  console.log("=".repeat(70));
  console.log(` Investigating user_id: ${userId}`);
  console.log("=".repeat(70));

  // Full profile read
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (pErr || !profile) {
    console.error("profile fetch:", pErr?.message ?? "no profile row");
    return;
  }
  console.log("");
  console.log("Profile row:");
  for (const [k, v] of Object.entries(profile)) {
    if (v === null || v === "") continue;
    console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
  }

  // owner_user_id link
  const ownerId = (profile as Record<string, unknown>).owner_user_id as
    | string
    | null;
  if (ownerId) {
    console.log("");
    console.log(`🔍 owner_user_id is set → this is a MANAGER profile.`);
    const { data: owner } = await supabase
      .from("profiles")
      .select("id, business_name, city, state, subscription_tier")
      .eq("id", ownerId)
      .maybeSingle();
    if (owner) {
      const o = owner as Record<string, unknown>;
      console.log(
        `   Manages: ${o.business_name ?? "(no business name)"}  [${o.id}]  ${o.city ?? "—"}, ${o.state ?? "—"}  tier=${o.subscription_tier}`
      );
    }
  } else {
    console.log("");
    console.log("   owner_user_id is NULL → this is a top-level operator account.");
  }

  // team_members link — managers can also be discovered via this table
  const { data: teamRows } = await supabase
    .from("team_members")
    .select("*")
    .or(`manager_user_id.eq.${userId},team_member_user_id.eq.${userId}`);
  console.log("");
  console.log(`team_members rows referencing this user: ${(teamRows ?? []).length}`);
  for (const r of (teamRows ?? []) as Record<string, unknown>[]) {
    console.log(`   ${JSON.stringify(r)}`);
  }

  // Event overlap with owner — if this is a manager, do her events
  // duplicate the owner's events (same date + name)?
  if (ownerId) {
    const [mineRes, ownerRes] = await Promise.all([
      supabase
        .from("events")
        .select("event_name, event_date, start_time, net_sales, pos_source, created_at")
        .eq("user_id", userId)
        .order("event_date", { ascending: true }),
      supabase
        .from("events")
        .select("event_name, event_date, start_time, net_sales, pos_source, created_at")
        .eq("user_id", ownerId)
        .order("event_date", { ascending: true }),
    ]);
    const mine = (mineRes.data ?? []) as Array<{
      event_name: string;
      event_date: string;
      start_time: string | null;
      net_sales: number | null;
      pos_source: string | null;
      created_at: string;
    }>;
    const owner = (ownerRes.data ?? []) as typeof mine;

    console.log("");
    console.log("=".repeat(70));
    console.log(" Manager events vs owner events");
    console.log("=".repeat(70));
    console.log(`  Manager: ${mine.length} events`);
    console.log(`  Owner:   ${owner.length} events`);

    // Same (lower(event_name), event_date) overlap
    const ownerKeys = new Set(
      owner.map((e) => `${e.event_name.toLowerCase().trim()}|${e.event_date}`)
    );
    const overlapping = mine.filter((e) =>
      ownerKeys.has(`${e.event_name.toLowerCase().trim()}|${e.event_date}`)
    );
    console.log("");
    console.log(
      `  Manager events sharing (name + date) with owner: ${overlapping.length} of ${mine.length}  (${
        mine.length > 0
          ? ((overlapping.length / mine.length) * 100).toFixed(1)
          : "—"
      }%)`
    );

    if (overlapping.length > 0) {
      console.log("");
      console.log("  Sample overlapping events (first 15):");
      for (const e of overlapping.slice(0, 15)) {
        const ownerMatch = owner.find(
          (o) =>
            o.event_name.toLowerCase().trim() ===
              e.event_name.toLowerCase().trim() && o.event_date === e.event_date
        )!;
        const mSales = e.net_sales != null ? `$${e.net_sales}` : "—";
        const oSales = ownerMatch.net_sales != null ? `$${ownerMatch.net_sales}` : "—";
        console.log(`    • ${e.event_name} · ${e.event_date}`);
        console.log(
          `        manager: sales=${mSales}, pos=${e.pos_source ?? "—"}, time=${e.start_time ?? "—"}, created=${e.created_at.slice(0, 10)}`
        );
        console.log(
          `        owner:   sales=${oSales}, pos=${ownerMatch.pos_source ?? "—"}, time=${ownerMatch.start_time ?? "—"}, created=${ownerMatch.created_at.slice(0, 10)}`
        );
      }
    }
  }

  // Check whether this user_id appears in platform_events aggregation by
  // verifying data_sharing_enabled — already known to be true. The
  // implication: regardless of manager status, events under this user_id
  // are aggregated as if they're a separate operator. That's the bug.
  console.log("");
  console.log("=".repeat(70));
  console.log(" Implication for platform_events");
  console.log("=".repeat(70));
  const sharing = (profile as Record<string, unknown>).data_sharing_enabled;
  console.log(
    `  data_sharing_enabled = ${JSON.stringify(sharing)}  →  events under this user_id are aggregated`
  );
  console.log(
    `  This bumps operator_count by +1 for every event_name overlap with the owner.`
  );
  if (ownerId && sharing) {
    console.log("");
    console.log(
      "  🚨 If this account is a MANAGER and her events are logged for the OWNER's"
    );
    console.log(
      "     bookings, those events double-count in platform_events aggregates:"
    );
    console.log(
      "     same booking, two operator_count contributors (manager + owner)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
