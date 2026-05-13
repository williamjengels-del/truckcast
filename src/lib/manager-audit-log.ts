// Audit-log writer for non-owner actions against owner-scoped data.
//
// Spawned 2026-05-14 to give owners visibility into manager + admin-
// impersonating actions on their account. Sarah is queued as Nick's
// first manager invitee — once she activates, this writer captures
// every event create / update / delete / financial-edit / inquiry-
// action she takes, so Nick can review later. Admin impersonation is
// captured under the same shape for the same reason.
//
// Design:
//   * No-op for scope.kind === "normal" (owner acting on their own
//     data) and "unauthorized". Only writes when actor !== owner.
//   * Never throws. Audit failures are console.error'd because losing
//     an audit row should not break the primary write. The audit log
//     is best-effort observability, not a synchronous gate.
//   * Writes via service-role client so the audit trail is unaffected
//     by the actor's RLS scope (managers can't write to audit rows
//     directly under their own session — only the service role can).
//   * Captures financial-impact + structural fields only. Cosmetic
//     fields (notes, content capture, in-service jot, day-of menu
//     details) are filtered out by CAPTURED_FIELDS below to keep the
//     feed scannable. PR 2 (Activity tab UI) reads back what this
//     writer captures.
//
// Migration: 20260514000001_create_manager_audit_log.sql.
// Runtime probe: writer auto-detects table-missing (Postgres 42P01,
// "relation does not exist") and short-circuits, so the code can
// safely deploy ahead of the migration paste.

import {
  createClient as createServiceClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { DashboardScope } from "@/lib/dashboard-scope";

/**
 * Event-table columns we care about in the audit log. Anything outside
 * this set is dropped from before/after diffs.
 *
 * Financial-impact:   net_sales, invoice_revenue, food_cost, labor_cost,
 *                     other_costs, fee_type, fee_rate, sales_minimum
 * Identity / status:  event_name, event_date, booked, cancellation_reason,
 *                     anomaly_flag
 * Time:               start_time, end_time, setup_time
 * Venue / location:   location, city, state, city_area
 * Operational meta:   event_type, event_tier, event_mode, event_weather,
 *                     expected_attendance, other_trucks, pos_source
 * Linkage:            caused_by_event_id, linked_contact_id (synthetic)
 *
 * Deliberately excluded (cosmetic / derived):
 *   notes, parking_loadin_notes, special_menu_details, menu_type,
 *   content_capture_notes, in_service_notes, after_event_summary,
 *   latitude, longitude, forecast_*, is_private, is_sample
 */
export const CAPTURED_EVENT_FIELDS = new Set<string>([
  "net_sales",
  "invoice_revenue",
  "food_cost",
  "labor_cost",
  "other_costs",
  "fee_type",
  "fee_rate",
  "sales_minimum",
  "event_name",
  "event_date",
  "booked",
  "cancellation_reason",
  "anomaly_flag",
  "start_time",
  "end_time",
  "setup_time",
  "location",
  "city",
  "state",
  "city_area",
  "event_type",
  "event_tier",
  "event_mode",
  "event_weather",
  "expected_attendance",
  "other_trucks",
  "pos_source",
  "caused_by_event_id",
  "linked_contact_id",
]);

/**
 * Field name → human-friendly label for summary composition.
 * Anything not in this map falls back to the raw column name.
 */
const FIELD_LABELS: Record<string, string> = {
  net_sales: "net sales",
  invoice_revenue: "invoice revenue",
  food_cost: "food cost",
  labor_cost: "labor cost",
  other_costs: "other costs",
  fee_type: "fee type",
  fee_rate: "fee rate",
  sales_minimum: "sales minimum",
  event_name: "name",
  event_date: "date",
  booked: "booked",
  cancellation_reason: "cancellation",
  anomaly_flag: "flag",
  start_time: "start time",
  end_time: "end time",
  setup_time: "setup time",
  event_type: "type",
  event_tier: "tier",
  event_mode: "mode",
  event_weather: "weather",
  expected_attendance: "expected attendance",
  other_trucks: "other trucks",
  pos_source: "pos source",
  caused_by_event_id: "caused-by link",
  linked_contact_id: "contact link",
};

const FINANCIAL_FIELDS = new Set<string>([
  "net_sales",
  "invoice_revenue",
  "food_cost",
  "labor_cost",
  "other_costs",
  "fee_type",
  "fee_rate",
  "sales_minimum",
]);

type Jsonish = Record<string, unknown>;

let cachedServiceClient: SupabaseClient | null = null;
function serviceClient(): SupabaseClient | null {
  if (cachedServiceClient) return cachedServiceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cachedServiceClient = createServiceClient(url, key);
  return cachedServiceClient;
}

/**
 * Pick only captured fields out of an arbitrary jsonish payload.
 * Returns null when the result would be empty (no captured fields
 * changed) so callers can skip the write entirely.
 */
export function pickCapturedFields(payload: Jsonish | null | undefined): Jsonish | null {
  if (!payload) return null;
  const out: Jsonish = {};
  let count = 0;
  for (const [k, v] of Object.entries(payload)) {
    if (CAPTURED_EVENT_FIELDS.has(k)) {
      out[k] = v;
      count += 1;
    }
  }
  return count > 0 ? out : null;
}

/**
 * Diff two captured-field jsonish blobs. Returns the subset where
 * before !== after (strict equality on primitives). Used to compose
 * the after-payload of an update audit row — we only want to record
 * the fields that actually changed.
 */
export function diffCapturedFields(
  before: Jsonish | null,
  after: Jsonish | null
): { beforeChanged: Jsonish | null; afterChanged: Jsonish | null } {
  if (!after) return { beforeChanged: null, afterChanged: null };
  const beforeChanged: Jsonish = {};
  const afterChanged: Jsonish = {};
  let count = 0;
  for (const [k, vAfter] of Object.entries(after)) {
    if (!CAPTURED_EVENT_FIELDS.has(k)) continue;
    const vBefore = before ? before[k] : undefined;
    // Treat undefined and null as equivalent for "no value" comparison.
    const aNull = vAfter === null || vAfter === undefined;
    const bNull = vBefore === null || vBefore === undefined;
    if (aNull && bNull) continue;
    if (vAfter !== vBefore) {
      beforeChanged[k] = vBefore ?? null;
      afterChanged[k] = vAfter;
      count += 1;
    }
  }
  return {
    beforeChanged: count > 0 ? beforeChanged : null,
    afterChanged: count > 0 ? afterChanged : null,
  };
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? `${v}` : v.toFixed(2);
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  return JSON.stringify(v);
}

/**
 * Compose a short human-readable summary for an update-style audit row
 * from the diff'd before/after blobs. Up to 3 fields surfaced inline;
 * remainder rolled into "+N more".
 */
export function summarizeFieldDiff(
  before: Jsonish | null,
  after: Jsonish | null
): string {
  if (!after) return "no captured field changes";
  const keys = Object.keys(after);
  if (keys.length === 0) return "no captured field changes";
  const parts: string[] = [];
  for (const k of keys.slice(0, 3)) {
    const label = FIELD_LABELS[k] ?? k;
    parts.push(`${label} ${fmt(before?.[k])} → ${fmt(after[k])}`);
  }
  if (keys.length > 3) parts.push(`+${keys.length - 3} more`);
  return parts.join("; ");
}

/**
 * Did any financial field change? Used by the action-classifier
 * (event.update vs event.financial_edit). Returns true if any field
 * in FINANCIAL_FIELDS is present in the after payload, since the
 * caller has already filtered to changed fields.
 */
export function hasFinancialChange(after: Jsonish | null): boolean {
  if (!after) return false;
  for (const k of Object.keys(after)) {
    if (FINANCIAL_FIELDS.has(k)) return true;
  }
  return false;
}

type RecordParams = {
  scope: DashboardScope;
  action: string;
  targetTable: string;
  targetId: string | null;
  before: Jsonish | null;
  after: Jsonish | null;
  summary?: string;
};

/**
 * Record a single audit-log row. No-ops for owner / unauthorized scope.
 * Never throws — failures log to console.error.
 *
 * Caller responsibility: the before/after payloads should already be
 * filtered through pickCapturedFields + diffCapturedFields, so this
 * function does not re-filter. summary may be precomposed; if absent,
 * we compose from the diff.
 */
export async function recordManagerAction(params: RecordParams): Promise<void> {
  const { scope, action, targetTable, targetId, before, after } = params;

  if (scope.kind === "normal" || scope.kind === "unauthorized") return;

  const actorKind: "manager" | "impersonating" =
    scope.kind === "manager" ? "manager" : "impersonating";

  const client = serviceClient();
  if (!client) {
    // Service-role env missing — degrade silently in dev. Production
    // should always have these set; if they're missing in prod the
    // primary write path would also be impaired so this isn't the
    // signal we'd want to investigate first.
    return;
  }

  const summary = params.summary ?? summarizeFieldDiff(before, after);

  try {
    const { error } = await client.from("manager_audit_log").insert({
      owner_user_id: scope.userId,
      actor_user_id: scope.realUserId,
      actor_kind: actorKind,
      action,
      target_table: targetTable,
      target_id: targetId,
      before,
      after,
      summary,
    });
    if (error) {
      // 42P01 = relation does not exist — migration not yet pasted.
      // Code shipped first, migration follows; swallow this case.
      if ((error as { code?: string }).code === "42P01") return;
      console.error(
        `[manager-audit-log] insert failed: ${error.message} (action=${action} target=${targetId ?? "—"})`
      );
    }
  } catch (err) {
    console.error(
      `[manager-audit-log] write threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Convenience: read the captured-field subset of an event row by id.
 * Used by the update / delete hooks to grab "before" state. Returns
 * null on missing row or read error (audit-log shouldn't block the
 * primary write).
 *
 * Reads via the service-role client to bypass RLS — we need the full
 * picture of the row regardless of the actor's scope. The values land
 * in an immutable audit row owned by the owner_user_id, so RLS is
 * preserved at the read-out end of the pipeline (only owner can SELECT
 * their own audit rows).
 */
export async function readCapturedEventState(
  eventId: string
): Promise<Jsonish | null> {
  const client = serviceClient();
  if (!client) return null;
  // Select only the captured fields by name to minimize payload size.
  const cols = Array.from(CAPTURED_EVENT_FIELDS).join(", ");
  try {
    const { data, error } = await client
      .from("events")
      .select(cols)
      .eq("id", eventId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as Jsonish;
  } catch {
    return null;
  }
}
