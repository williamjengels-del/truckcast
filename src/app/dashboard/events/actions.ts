"use server";

import { revalidatePath } from "next/cache";
import { recalculateForUser } from "@/lib/recalculate";
import { autoClassifyWeather } from "@/lib/weather";
import { canonicalizeCityAndState } from "@/lib/city-normalize";
import { resolveScopedSupabase, type DashboardScope } from "@/lib/dashboard-scope";
import {
  recordManagerAction,
  readCapturedEventState,
  pickCapturedFields,
  diffCapturedFields,
  summarizeFieldDiff,
  hasFinancialChange,
} from "@/lib/manager-audit-log";
import type { Event } from "@/lib/database.types";

// M-3 fix (2026-05-09): every server action below resolves through
// resolveScopedSupabase() so manager + impersonation + normal sessions
// all write under the correct user_id. Pre-fix, every action did
// `user_id: user.id` directly — manager INSERTs got RLS-rejected
// (their own id != owner_user_id) and the Premium "Add a manager"
// feature was effectively non-functional.
//
// Conventions:
//   - scope.userId is the OWNER's id for manager sessions, the user's
//     own id for normal sessions, the target's id for impersonation.
//   - scope.realUserId is the actor's id (the manager themselves, or
//     the admin doing the impersonation). Use for audit trails.
//   - scope.client is RLS-authed for normal/manager, service-role for
//     impersonation. RLS policies on events + event_performance now
//     cover the manager case via team_members lookup; service-role
//     bypasses for impersonation.
//   - recalculateForUser(scope.userId) — recalc writes against owner's
//     event_performance (RLS extended in 20260509000005).
//
// Bulk-destructive actions (deleteAllEvents) remain owner-only by an
// explicit scope.kind === "normal" check, even though the underlying
// RLS would let managers run them. "Delete every event your owner has"
// is policy-grade dangerous and shouldn't be fireable from a manager
// session.

function requireWritableScope(scope: DashboardScope) {
  if (scope.kind === "unauthorized") {
    throw new Error("Not authenticated");
  }
  return scope;
}

export type EventFormData = {
  event_name: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  setup_time?: string;
  location?: string;
  city?: string;
  state?: string;
  city_area?: string;
  latitude?: number;
  longitude?: number;
  booked?: boolean;
  is_private?: boolean;
  net_sales?: number;
  invoice_revenue?: number;
  event_type?: string;
  event_tier?: string;
  event_weather?: string;
  anomaly_flag?: string;
  event_mode?: string;
  expected_attendance?: number;
  other_trucks?: number;
  fee_type?: string;
  fee_rate?: number;
  sales_minimum?: number;
  forecast_sales?: number;
  food_cost?: number;
  labor_cost?: number;
  other_costs?: number;
  notes?: string;
  pos_source?: string;
  cancellation_reason?: string | null;
  /** UUID of the event whose outcome caused this cancellation (e.g.,
   *  sold-out carry-over). Persisted into events.caused_by_event_id by
   *  both create and update flows. Empty string serializes to null in
   *  updateEvent's generic for-loop. */
  caused_by_event_id?: string | null;
  /** Day-of card v1 (migration 20260430000001). All optional; defaults
   *  on the column side ('regular' for menu_type, [] for in_service_notes). */
  parking_loadin_notes?: string | null;
  menu_type?: "regular" | "special";
  special_menu_details?: string | null;
  /** UI-only — not a column on events. Set by EventForm when the
   *  operator toggles "Multi-Day Event" and picks an end date. The
   *  client-side handleCreate branches on this and calls
   *  createMultiDayEvents instead of createEvent so the server inserts
   *  one row per date in the range. Each row gets a unique event_date
   *  but shares every other field. */
  multi_day_dates?: string[];
  /** UI-only — not a column on events. The form's "Link contact"
   *  picker sets this on the data payload; create/update actions
   *  reconcile against the prior link (if any) by writing to the
   *  contacts side (Contact.linked_event_ids) after the event upsert.
   *
   *  Semantics:
   *    null  → operator explicitly cleared any prior link
   *    undef → no change (preserve current link, no contacts write)
   *    uuid  → link this contact (and unlink any prior different one) */
  linked_contact_id?: string | null;
};

/**
 * Reconcile the contact-side link for a given event_id. Looks up the
 * current set of contacts linking to this event, computes the diff
 * vs the operator's picked contact, and applies the minimum changes
 * (link new, unlink prior). Called from createEvent + updateEvent +
 * createMultiDayEvents after the event upsert succeeds.
 *
 * Pass nextContactId === undefined to skip entirely (preserve current
 * state). Pass null to explicitly unlink whatever's currently linked.
 */
async function reconcileEventContactLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ownerUserId: string,
  eventId: string,
  nextContactId: string | null | undefined
): Promise<void> {
  if (nextContactId === undefined) return;

  // Find any contacts currently linking to this event_id. Uses the
  // GIN-indexed .contains() filter on linked_event_ids.
  const { data: currentLinks } = await supabase
    .from("contacts")
    .select("id, linked_event_ids")
    .eq("user_id", ownerUserId)
    .contains("linked_event_ids", [eventId]);

  const currentLinked = (currentLinks ?? []) as {
    id: string;
    linked_event_ids: string[] | null;
  }[];

  // Unlink any contact that's NOT the new pick (handles change + clear).
  for (const c of currentLinked) {
    if (c.id === nextContactId) continue;
    const next = (c.linked_event_ids ?? []).filter((id) => id !== eventId);
    await supabase
      .from("contacts")
      .update({ linked_event_ids: next })
      .eq("id", c.id)
      .eq("user_id", ownerUserId);
  }

  // Link to the new contact (if any) — idempotent.
  if (nextContactId) {
    const alreadyLinked = currentLinked.some((c) => c.id === nextContactId);
    if (!alreadyLinked) {
      const { data: target } = await supabase
        .from("contacts")
        .select("linked_event_ids")
        .eq("id", nextContactId)
        .eq("user_id", ownerUserId)
        .maybeSingle();
      const existing =
        (target as { linked_event_ids: string[] | null } | null)
          ?.linked_event_ids ?? [];
      if (!existing.includes(eventId)) {
        await supabase
          .from("contacts")
          .update({ linked_event_ids: [...existing, eventId] })
          .eq("id", nextContactId)
          .eq("user_id", ownerUserId);
      }
    }
  }
}

export async function createEvent(formData: EventFormData) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  const insertData: Record<string, unknown> = {
    user_id: userId,
    event_name: formData.event_name,
    event_date: formData.event_date,
    booked: formData.booked ?? true,
    is_private: formData.is_private ?? false,
  };

  // Only include optional fields if they have values.
  // City + state are normalized together: trailing state suffixes ("Saint
  // Louis Mo") are extracted into the state column; abbreviations and
  // casing canonicalize ("St. Louis" → "Saint Louis", "O'fallon" →
  // "O'Fallon"). Operator-provided state takes precedence over any
  // suffix found in the city string. See src/lib/city-normalize.ts.
  const { city: canonicalCity, state: canonicalState } = canonicalizeCityAndState(
    formData.city,
    formData.state
  );
  if (formData.start_time) insertData.start_time = formData.start_time;
  if (formData.end_time) insertData.end_time = formData.end_time;
  if (formData.setup_time) insertData.setup_time = formData.setup_time;
  if (formData.location) insertData.location = formData.location;
  if (canonicalCity) insertData.city = canonicalCity;
  if (canonicalState) insertData.state = canonicalState;
  if (formData.city_area) insertData.city_area = formData.city_area;
  if (formData.latitude) insertData.latitude = formData.latitude;
  if (formData.longitude) insertData.longitude = formData.longitude;

  // Auto-geocode + classify weather when city is provided and weather not manually set.
  // State (when present) disambiguates the geocoding pick.
  if (canonicalCity && !formData.event_weather) {
    try {
      const wx = await autoClassifyWeather(
        canonicalCity,
        formData.event_date,
        supabase,
        canonicalState ?? null
      );
      if (wx) {
        insertData.event_weather = wx.classification;
        if (!formData.latitude) insertData.latitude = wx.latitude;
        if (!formData.longitude) insertData.longitude = wx.longitude;
      }
    } catch {
      // Non-fatal — skip if geo/weather fails
    }
  }
  if (formData.net_sales !== undefined && formData.net_sales !== null)
    insertData.net_sales = formData.net_sales;
  if (formData.invoice_revenue !== undefined && formData.invoice_revenue !== null)
    insertData.invoice_revenue = formData.invoice_revenue;
  if (formData.event_type) insertData.event_type = formData.event_type;
  if (formData.event_tier) insertData.event_tier = formData.event_tier;
  if (formData.event_weather) insertData.event_weather = formData.event_weather;
  if (formData.anomaly_flag) insertData.anomaly_flag = formData.anomaly_flag;
  if (formData.event_mode) insertData.event_mode = formData.event_mode;
  if (formData.expected_attendance)
    insertData.expected_attendance = formData.expected_attendance;
  if (formData.other_trucks !== undefined && formData.other_trucks !== null)
    insertData.other_trucks = formData.other_trucks;
  if (formData.fee_type) insertData.fee_type = formData.fee_type;
  if (formData.fee_rate !== undefined && formData.fee_rate !== null)
    insertData.fee_rate = formData.fee_rate;
  if (formData.sales_minimum !== undefined && formData.sales_minimum !== null)
    insertData.sales_minimum = formData.sales_minimum;
  if (formData.food_cost !== undefined && formData.food_cost !== null)
    insertData.food_cost = formData.food_cost;
  if (formData.labor_cost !== undefined && formData.labor_cost !== null)
    insertData.labor_cost = formData.labor_cost;
  if (formData.other_costs !== undefined && formData.other_costs !== null)
    insertData.other_costs = formData.other_costs;
  if (formData.notes) insertData.notes = formData.notes;
  if (formData.pos_source) insertData.pos_source = formData.pos_source;
  if (formData.cancellation_reason) insertData.cancellation_reason = formData.cancellation_reason;
  if (formData.caused_by_event_id) insertData.caused_by_event_id = formData.caused_by_event_id;
  // Day-of card v1 fields. menu_type column has a NOT NULL DEFAULT
  // 'regular', so omitting it on insert is fine — only persist when the
  // operator explicitly picks "special" or fills the textarea.
  if (formData.parking_loadin_notes)
    insertData.parking_loadin_notes = formData.parking_loadin_notes;
  if (formData.menu_type && formData.menu_type !== "regular")
    insertData.menu_type = formData.menu_type;
  if (formData.special_menu_details)
    insertData.special_menu_details = formData.special_menu_details;

  const { data, error } = await supabase
    .from("events")
    .insert(insertData)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Reconcile contact link if the form picked one. New event has no
  // prior link by definition, so this is link-only (no unlink path).
  if (formData.linked_contact_id !== undefined && data?.id) {
    await reconcileEventContactLink(
      supabase,
      userId,
      data.id as string,
      formData.linked_contact_id
    );
  }

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  if (formData.linked_contact_id !== undefined) {
    revalidatePath("/dashboard/contacts");
  }

  // Audit-log non-owner create. Captures the inserted row's financial
  // + structural fields, plus the optional linked_contact_id pick.
  const afterCreate = pickCapturedFields({
    ...insertData,
    linked_contact_id: formData.linked_contact_id ?? null,
  });
  if (data?.id) {
    await recordManagerAction({
      scope,
      action: "event.create",
      targetTable: "events",
      targetId: data.id as string,
      before: null,
      after: afterCreate,
      summary: `created event '${formData.event_name}' on ${formData.event_date}`,
    });
  }

  // Recalculate performance and forecasts in the background — for
  // the OWNER's data, regardless of who triggered the action.
  recalculateForUser(userId).catch(() => {});

  return data as Event;
}

/**
 * Multi-day event creation — given a shared event payload and a list of
 * dates, insert one row per date and run a single recalc at the end.
 * Each row gets a unique event_date but shares every other field
 * (name, venue, type, times, fee shape, etc.). This is the create-side
 * inverse of the codebase's existing multi-day consolidation rules
 * (which already split clusters into per-day rows in the engine), so
 * the storage shape stays consistent.
 *
 * Caller responsibility: pass a date list that's sorted and unique.
 * The form's generateDateRange helper already does this. Server-side
 * we re-dedupe defensively and cap at 31 dates to avoid runaway loops
 * if a date range is misconfigured.
 *
 * Weather auto-classification runs once per date — same path as
 * single-event create — so each day gets its own weather row.
 * Recalc runs once at the end, not per-row.
 */
export async function createMultiDayEvents(
  formData: EventFormData,
  dates: string[]
): Promise<{ created: Event[] }> {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { userId } = scope as Exclude<DashboardScope, { kind: "unauthorized" }>;

  const uniqueDates = Array.from(new Set(dates)).sort();
  if (uniqueDates.length === 0) {
    throw new Error("Multi-day event needs at least one date");
  }
  if (uniqueDates.length > 31) {
    throw new Error("Multi-day event is capped at 31 days");
  }

  const created: Event[] = [];
  for (const date of uniqueDates) {
    // Call createEvent for each date — keeps weather classification +
    // city canonicalization + insert + revalidate logic in one place.
    // recalculateForUser inside createEvent fires per-call but the
    // recalc-lock from PR #253 serializes them so only one runs at a
    // time per user; the others short-circuit cheap.
    const row = await createEvent({
      ...formData,
      event_date: date,
      // Strip the UI-only multi_day_dates field before recursing —
      // each per-day call is a normal single-event insert.
      multi_day_dates: undefined,
    });
    created.push(row);
  }

  // One forced recalc at the end so the platform_prior + tier inference
  // sees the full cluster (rather than stale state from row 1 when row
  // 2 inserts). The per-call recalcs inside createEvent already short-
  // circuit on the lock so this is just an explicit final pass.
  recalculateForUser(userId).catch(() => {});

  return { created };
}

export async function updateEvent(id: string, formData: Partial<EventFormData>) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  // Snapshot the captured-field subset BEFORE applying the update so
  // the audit row can diff before/after. Skip the read when scope is
  // owner — no audit row to write anyway. readCapturedEventState uses
  // the service-role client so the actor's RLS doesn't restrict it.
  const auditBefore =
    scope.kind === "normal" ? null : await readCapturedEventState(id);

  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(formData)) {
    // multi_day_dates is a UI-only field consumed by
    // createMultiDayEvents; not a column on the events table. The
    // form already gates it to create-mode but guard here defensively
    // so an accidental payload won't 400 the update.
    if (key === "multi_day_dates") continue;
    // linked_contact_id is a UI-only field consumed by
    // reconcileEventContactLink above. Stripping here is belt-and-
    // suspenders — the generic loop would otherwise try to UPDATE
    // a non-existent column.
    if (key === "linked_contact_id") continue;
    if (value !== undefined) {
      updateData[key] = value === "" ? null : value;
    }
  }

  // Canonicalize city at write time if it's in the update payload.
  // Use the combined helper so a paste of "Saint Louis Mo" lands as
  // city="Saint Louis", state="MO" (when state isn't otherwise being
  // updated explicitly). Operator-supplied state in the form takes
  // precedence over any extracted suffix.
  if ("city" in formData && formData.city !== undefined) {
    const { city: canonical, state: extractedState } = canonicalizeCityAndState(
      formData.city,
      formData.state
    );
    updateData.city = canonical || null;
    if (!("state" in formData) && extractedState) {
      // Operator didn't touch state; populate from the suffix we just
      // peeled off the city string. (When formData.state IS provided,
      // the existing loop above has already copied it to updateData
      // and the explicit value wins.)
      updateData.state = extractedState;
    }
  }

  // Auto-geocode + classify weather when city / state / date change and
  // weather not manually set. State is read from the update payload
  // when changing, or the current event row when unchanged — so a
  // city-only edit still benefits from the existing state's
  // disambiguation.
  const newCity = updateData.city as string | null | undefined;
  const newDate = formData.event_date;
  const newState = formData.state;
  // Flip pos_source to "manual" when the operator edits any financial
  // field via the event-form modal. This claims the row's sales numbers
  // as operator-canonical so future POS syncs (sync.ts respects
  // pos_source==="manual" via its eligibility filter) won't overwrite
  // them. Bug history: rows that originated from a Square / Toast sync
  // kept pos_source="square" or "toast" through the form-edit path,
  // leaving operator's Square+ACH combined edits vulnerable to the
  // next manual sync silently reverting them to the POS-only slice.
  // Only flip when a financial field is in the payload — pure metadata
  // edits (location, notes, contact link) shouldn't claim the sales
  // numbers as operator-canonical.
  const financialFieldsTouched =
    formData.net_sales !== undefined ||
    formData.invoice_revenue !== undefined;
  if (financialFieldsTouched) {
    updateData.pos_source = "manual";
  }

  if ((newCity !== undefined || newDate || newState !== undefined) && !formData.event_weather) {
    const { data: current } = await supabase
      .from("events")
      .select("city, state, event_date, latitude, longitude")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    const resolvedCity = newCity ?? current?.city;
    const resolvedDate = newDate ?? current?.event_date;
    const resolvedState = newState ?? current?.state ?? null;
    if (resolvedCity && resolvedDate) {
      try {
        const wx = await autoClassifyWeather(
          resolvedCity,
          resolvedDate,
          supabase,
          resolvedState
        );
        if (wx) {
          updateData.event_weather = wx.classification;
          if (!formData.latitude && !current?.latitude) updateData.latitude = wx.latitude;
          if (!formData.longitude && !current?.longitude) updateData.longitude = wx.longitude;
        }
      } catch {
        // Non-fatal
      }
    }
  }

  const { data, error } = await supabase
    .from("events")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Reconcile contact link if the form sent a (possibly-null) pick.
  // Undefined = no change, preserve existing link.
  if (formData.linked_contact_id !== undefined) {
    await reconcileEventContactLink(
      supabase,
      userId,
      id,
      formData.linked_contact_id
    );
    revalidatePath("/dashboard/contacts");
  }

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");

  // Audit-log non-owner update. The contact link is a UI-only field
  // not on the events table, but it's a captured field in the log so
  // we splice it into the after payload for diffing. The before
  // snapshot doesn't include linked_contact_id (we'd have to look it
  // up from the contacts side), so contact link changes always read
  // as "—  → uuid" in the summary — that's fine, it's still a clear
  // signal of "manager linked a contact here".
  const auditAfterRaw: Record<string, unknown> = { ...updateData };
  if (formData.linked_contact_id !== undefined) {
    auditAfterRaw.linked_contact_id = formData.linked_contact_id ?? null;
  }
  const { beforeChanged, afterChanged } = diffCapturedFields(
    auditBefore,
    auditAfterRaw
  );
  if (afterChanged) {
    const action = hasFinancialChange(afterChanged)
      ? "event.financial_edit"
      : "event.update";
    await recordManagerAction({
      scope,
      action,
      targetTable: "events",
      targetId: id,
      before: beforeChanged,
      after: afterChanged,
      summary: summarizeFieldDiff(beforeChanged, afterChanged),
    });
  }

  recalculateForUser(userId).catch(() => {});
  return data as Event;
}

/**
 * Append a timestamped entry to events.in_service_notes (jsonb array).
 * Used by the day-of card inline editor — operator drops a quick note
 * mid-service and it lands on the event record with a timestamp.
 *
 * Append-only: the card can only add. Editing or deleting past
 * entries happens on the events page (advanced section, future).
 */
export async function appendInServiceNote(eventId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Note text required");

  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  // Read-modify-write — Supabase doesn't expose jsonb_array_append on
  // the JS client. RLS keeps this scoped to the operator's own row.
  const { data: current, error: readErr } = await supabase
    .from("events")
    .select("in_service_notes")
    .eq("id", eventId)
    .eq("user_id", userId)
    .single();
  if (readErr) throw new Error(readErr.message);

  const existing = Array.isArray(current?.in_service_notes)
    ? (current.in_service_notes as { timestamp: string; text: string }[])
    : [];
  const next = [...existing, { timestamp: new Date().toISOString(), text: trimmed }];

  const { error: writeErr } = await supabase
    .from("events")
    .update({ in_service_notes: next })
    .eq("id", eventId)
    .eq("user_id", userId);
  if (writeErr) throw new Error(writeErr.message);

  revalidatePath("/dashboard");
  return next;
}

/**
 * Save the after-event summary on a wrapped-up event. Optionally
 * updates net_sales when the operator enters a final figure during
 * wrap-up that differs from the auto-logged value.
 */
export async function saveAfterEventSummary(
  eventId: string,
  summary: {
    final_sales: number | null;
    wrap_up_note: string | null;
    what_id_change: string | null;
  }
) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  const update: Record<string, unknown> = { after_event_summary: summary };
  // If the operator entered a final sales number during wrap-up,
  // also update net_sales — that's the canonical column the rest
  // of the app reads from. Skip when null/unchanged to avoid
  // clobbering POS-sync'd values.
  if (summary.final_sales !== null) {
    update.net_sales = summary.final_sales;
  }

  // Snapshot net_sales before-state for audit when a final_sales write
  // is in play (only meaningful when a non-owner is editing). The
  // after_event_summary jsonb itself is cosmetic, not captured.
  const auditBefore =
    scope.kind !== "normal" && summary.final_sales !== null
      ? await readCapturedEventState(eventId)
      : null;

  const { error } = await supabase
    .from("events")
    .update(update)
    .eq("id", eventId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/events");

  // Audit-log non-owner after-event-summary writes. Only fire when
  // net_sales actually changed — the summary jsonb itself doesn't
  // qualify as captured. summarizeFieldDiff handles the formatting.
  if (summary.final_sales !== null) {
    const auditAfter = pickCapturedFields({ net_sales: summary.final_sales });
    const { beforeChanged, afterChanged } = diffCapturedFields(
      auditBefore,
      auditAfter
    );
    if (afterChanged) {
      await recordManagerAction({
        scope,
        action: "event.after_event_summary",
        targetTable: "events",
        targetId: eventId,
        before: beforeChanged,
        after: afterChanged,
        summary: `wrap-up: ${summarizeFieldDiff(beforeChanged, afterChanged)}`,
      });
    }
  }

  recalculateForUser(userId).catch(() => {});
}

/**
 * Set events.content_capture_notes — free-form scratchpad for B-roll
 * moments, story ideas, photo references. Edited (not appended);
 * latest write wins.
 */
export async function updateContentCapture(eventId: string, text: string) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  const { error } = await supabase
    .from("events")
    .update({ content_capture_notes: text || null })
    .eq("id", eventId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
}

export async function deleteEvent(id: string) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  // Snapshot the row BEFORE the delete so the audit log preserves what
  // the manager removed. Skip the read when scope is owner — no audit
  // row to write.
  const auditBefore =
    scope.kind === "normal" ? null : await readCapturedEventState(id);

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");

  // Audit-log non-owner delete. before is the captured snapshot, after
  // is null. Summary surfaces the event name + date inline so the
  // owner can identify what was removed without expanding the row.
  if (auditBefore) {
    const name = (auditBefore.event_name as string | null) ?? "(unnamed)";
    const date = (auditBefore.event_date as string | null) ?? "(no date)";
    await recordManagerAction({
      scope,
      action: "event.delete",
      targetTable: "events",
      targetId: id,
      before: auditBefore,
      after: null,
      summary: `deleted event '${name}' on ${date}`,
    });
  }

  recalculateForUser(userId).catch(() => {});
}

export async function updateEventSales(id: string, netSales: number) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  // Snapshot net_sales + pos_source before the write so the audit log
  // can show the diff. Skip for owner scope.
  const auditBefore =
    scope.kind === "normal" ? null : await readCapturedEventState(id);

  // Flip pos_source to "manual" alongside the net_sales write — see the
  // same rationale in updateEvent above. updateEventSales is the inline
  // sales editor; every call mutates the operator's canonical sales
  // number and therefore should claim the row.
  const { data, error } = await supabase
    .from("events")
    .update({ net_sales: netSales, pos_source: "manual" })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");

  // Audit-log non-owner inline-sales edits. Always classified as
  // financial_edit (the whole point of this endpoint is the net_sales
  // write). The pos_source flip is captured incidentally.
  const auditAfter = pickCapturedFields({
    net_sales: netSales,
    pos_source: "manual",
  });
  const { beforeChanged, afterChanged } = diffCapturedFields(
    auditBefore,
    auditAfter
  );
  if (afterChanged) {
    await recordManagerAction({
      scope,
      action: "event.financial_edit",
      targetTable: "events",
      targetId: id,
      before: beforeChanged,
      after: afterChanged,
      summary: summarizeFieldDiff(beforeChanged, afterChanged),
    });
  }

  recalculateForUser(userId).catch(() => {});
  return data as Event;
}

/**
 * Dismiss a "Needs Attention" event by setting its anomaly_flag and optionally net_sales.
 * - "disrupted": storm, cancellation, no-show — excluded from forecasting
 * - "normal" with net_sales=0: intentional zero (charity, donated)
 */
export async function dismissFlaggedEvent(
  id: string,
  reason: "disrupted" | "charity"
) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  // Charity path writes net_sales=0 intentionally; flip pos_source so a
  // later POS sync doesn't blow away the zero with a stray POS slice
  // (same write-path-claim rule as updateEvent / updateEventSales).
  // Disrupted path doesn't touch net_sales; pos_source stays unchanged.
  const updateData: Record<string, unknown> =
    reason === "disrupted"
      ? { anomaly_flag: "disrupted" }
      : { anomaly_flag: "normal", net_sales: 0, pos_source: "manual" };

  // Snapshot for audit. Charity path zeros out net_sales which is a
  // financial-impact edit — owner deserves to see this in the log.
  const auditBefore =
    scope.kind === "normal" ? null : await readCapturedEventState(id);

  const { error } = await supabase
    .from("events")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");

  // Audit-log non-owner dismissals. The action name keeps the
  // dismissal-intent visible in the feed (vs a generic event.update).
  const auditAfter = pickCapturedFields(updateData);
  const { beforeChanged, afterChanged } = diffCapturedFields(
    auditBefore,
    auditAfter
  );
  if (afterChanged) {
    await recordManagerAction({
      scope,
      action: "event.dismiss_flagged",
      targetTable: "events",
      targetId: id,
      before: beforeChanged,
      after: afterChanged,
      summary: `dismissed as ${reason}: ${summarizeFieldDiff(beforeChanged, afterChanged)}`,
    });
  }

  recalculateForUser(userId).catch(() => {});
}

export async function deleteAllEvents() {
  const scope = requireWritableScope(await resolveScopedSupabase());

  // Owner-only. Even though manager RLS allows DELETE on individual
  // events (migration 20260509000005), bulk wipe is a policy-grade
  // destructive action and a manager session shouldn't be able to fire
  // it. Surfacing kind === "manager" as a different error makes the
  // refusal explicit instead of silently no-op'ing the call.
  if (scope.kind === "manager") {
    throw new Error(
      "Only the owner can delete all events. Ask the account owner to perform this action."
    );
  }
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" | "manager" }
  >;

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  // Also clear event performance
  await supabase
    .from("event_performance")
    .delete()
    .eq("user_id", userId);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/forecasts");
}

export async function getEvents(filters?: {
  upcoming?: boolean;
  past?: boolean;
  booked?: boolean;
  search?: string;
}) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  let query = supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .order("event_date", { ascending: false });

  if (filters?.upcoming) {
    query = query.gte("event_date", new Date().toISOString().split("T")[0]);
  }
  if (filters?.past) {
    query = query.lt("event_date", new Date().toISOString().split("T")[0]);
  }
  if (filters?.booked !== undefined) {
    query = query.eq("booked", filters.booked);
  }
  if (filters?.search) {
    query = query.ilike("event_name", `%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Event[];
}

export async function getEvent(id: string) {
  const scope = requireWritableScope(await resolveScopedSupabase());
  const { client: supabase, userId } = scope as Exclude<
    DashboardScope,
    { kind: "unauthorized" }
  >;

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) throw new Error(error.message);
  return data as Event;
}
