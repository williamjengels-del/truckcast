import { NextRequest, NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

/**
 * POST /api/events/bulk-update
 *
 * Bulk-apply ONE enum field's value across multiple selected events.
 * Powers the Needs Attention tab's bulk-edit toolbar (Tier 3 onboarding-
 * velocity feature). Operator multi-selects events, picks a field +
 * value, applies — saves dozens of per-event clicks during cleanup.
 *
 * Body: { ids: string[], field: BulkField, value: string }
 *
 * Per-field allowlist + enum validation is enforced server-side so a
 * tampered client can't bulk-set arbitrary columns. We deliberately
 * support only enum-typed fields here: free-text fields (location,
 * notes), per-event numerics (net_sales, fees), and derived columns
 * (forecasts) are excluded because bulk-applying the same value across
 * many rows doesn't make sense for them.
 *
 * Scoping: resolveScopedSupabase resolves manager → owner so a manager
 * with Pro+ permissions bulk-edits the owner's events. The UPDATE is
 * .eq("user_id", scope.userId) for defense-in-depth even though the RLS
 * policy enforces the same thing — belt + suspenders.
 *
 * No partial-success — if any id is missing or fails the scoped where,
 * the UPDATE just doesn't touch those rows (returns updated count <
 * len(ids) but the response succeeds). Client surfaces "Updated N of M"
 * when they don't match.
 */

import type { EventType, EventMode, WeatherType } from "@/lib/database.types";
import { recordManagerAction } from "@/lib/manager-audit-log";

type BulkField =
  | "event_type"
  | "event_mode"
  | "event_weather"
  | "event_size_tier_operator";

const VALID_EVENT_TYPE: readonly EventType[] = [
  "Festival",
  "Concert",
  "Community/Neighborhood",
  "Corporate",
  "Weekly Series",
  "Private",
  "Sports Event",
  "Fundraiser/Charity",
  "Wedding",
  "Private Party",
  "Reception",
];
// "Private/Catering" deliberately excluded — legacy, hidden from new selects.

const VALID_EVENT_MODE: readonly EventMode[] = ["food_truck", "catering"];

const VALID_WEATHER: readonly WeatherType[] = [
  "Clear",
  "Overcast",
  "Hot",
  "Cold",
  "Rain Before Event",
  "Rain During Event",
  "Storms",
  "Snow",
];

const VALID_TIER = ["SMALL", "NORMAL", "LARGE", "FLAGSHIP"] as const;

const MAX_IDS_PER_REQUEST = 500;

function validateValue(field: BulkField, value: string): boolean {
  switch (field) {
    case "event_type":
      return (VALID_EVENT_TYPE as readonly string[]).includes(value);
    case "event_mode":
      return (VALID_EVENT_MODE as readonly string[]).includes(value);
    case "event_weather":
      return (VALID_WEATHER as readonly string[]).includes(value);
    case "event_size_tier_operator":
      return (VALID_TIER as readonly string[]).includes(value);
  }
}

export async function POST(req: NextRequest) {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const r = body as Record<string, unknown>;

  const ids = Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === "string") : null;
  const field = typeof r.field === "string" ? (r.field as BulkField) : null;
  const value = typeof r.value === "string" ? r.value : null;

  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: "ids must be a non-empty string array" },
      { status: 400 }
    );
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_IDS_PER_REQUEST} events per request` },
      { status: 400 }
    );
  }
  if (
    field !== "event_type" &&
    field !== "event_mode" &&
    field !== "event_weather" &&
    field !== "event_size_tier_operator"
  ) {
    return NextResponse.json(
      { error: "field must be event_type, event_mode, event_weather, or event_size_tier_operator" },
      { status: 400 }
    );
  }
  if (value === null || !validateValue(field, value)) {
    return NextResponse.json(
      { error: `Invalid value for ${field}` },
      { status: 400 }
    );
  }

  const update: Record<string, string> = { [field]: value };

  // Scoped UPDATE — RLS enforces user_id match too; .eq is defense-in-depth.
  const { data, error } = await scope.client
    .from("events")
    .update(update)
    .in("id", ids)
    .eq("user_id", scope.userId)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Update failed" },
      { status: 500 }
    );
  }

  // Audit-log non-owner bulk edits. One row per affected event so the
  // owner's Activity feed shows the impact granularly; the same field+
  // value pair across rows lets PR 2's UI cluster them into a single
  // "Sarah bulk-set event_type=Concert on 12 events" entry without
  // losing per-event traceability. before is the pre-update value
  // (queryable from the audit row if needed in the future) — kept
  // null here to skip the per-id read storm, since for the bulk-edit
  // surface the field+value pair already tells the story.
  const updatedIds = (data ?? []).map((d) => d.id as string);
  if (updatedIds.length > 0 && (scope.kind === "manager" || scope.kind === "impersonating")) {
    await Promise.all(
      updatedIds.map((eventId) =>
        recordManagerAction({
          scope,
          action: "event.bulk_update",
          targetTable: "events",
          targetId: eventId,
          before: null,
          after: { [field]: value },
          summary: `bulk-set ${field} = ${value}`,
        })
      )
    );
  }

  return NextResponse.json({
    success: true,
    requested: ids.length,
    updated: (data ?? []).length,
    field,
    value,
  });
}
