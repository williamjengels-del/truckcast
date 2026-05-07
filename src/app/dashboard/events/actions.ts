"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { recalculateForUser } from "@/lib/recalculate";
import { autoClassifyWeather } from "@/lib/weather";
import { canonicalizeCityAndState } from "@/lib/city-normalize";
import type { Event } from "@/lib/database.types";

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
};

export async function createEvent(formData: EventFormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const insertData: Record<string, unknown> = {
    user_id: user.id,
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

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");

  // Recalculate performance and forecasts in the background
  recalculateForUser(user.id).catch(() => {});

  return data as Event;
}

export async function updateEvent(id: string, formData: Partial<EventFormData>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(formData)) {
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
      // the existing loop at line 176 has already copied it to
      // updateData and the explicit value wins.)
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
  if ((newCity !== undefined || newDate || newState !== undefined) && !formData.event_weather) {
    const { data: current } = await supabase
      .from("events")
      .select("city, state, event_date, latitude, longitude")
      .eq("id", id)
      .eq("user_id", user.id)
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
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  recalculateForUser(user.id).catch(() => {});
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Read-modify-write — Supabase doesn't expose jsonb_array_append on
  // the JS client. RLS keeps this scoped to the operator's own row.
  const { data: current, error: readErr } = await supabase
    .from("events")
    .select("in_service_notes")
    .eq("id", eventId)
    .eq("user_id", user.id)
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
    .eq("user_id", user.id);
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const update: Record<string, unknown> = { after_event_summary: summary };
  // If the operator entered a final sales number during wrap-up,
  // also update net_sales — that's the canonical column the rest
  // of the app reads from. Skip when null/unchanged to avoid
  // clobbering POS-sync'd values.
  if (summary.final_sales !== null) {
    update.net_sales = summary.final_sales;
  }

  const { error } = await supabase
    .from("events")
    .update(update)
    .eq("id", eventId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/events");
  recalculateForUser(user.id).catch(() => {});
}

/**
 * Set events.content_capture_notes — free-form scratchpad for B-roll
 * moments, story ideas, photo references. Edited (not appended);
 * latest write wins.
 */
export async function updateContentCapture(eventId: string, text: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("events")
    .update({ content_capture_notes: text || null })
    .eq("id", eventId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
}

export async function deleteEvent(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  recalculateForUser(user.id).catch(() => {});
}

export async function updateEventSales(id: string, netSales: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("events")
    .update({ net_sales: netSales })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  recalculateForUser(user.id).catch(() => {});
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const updateData: Record<string, unknown> =
    reason === "disrupted"
      ? { anomaly_flag: "disrupted" }
      : { anomaly_flag: "normal", net_sales: 0 }; // charity: $0 is intentional

  const { error } = await supabase
    .from("events")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard");
  recalculateForUser(user.id).catch(() => {});
}

export async function deleteAllEvents() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  // Also clear event performance
  await supabase
    .from("event_performance")
    .delete()
    .eq("user_id", user.id);

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  let query = supabase
    .from("events")
    .select("*")
    .eq("user_id", user.id)
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error) throw new Error(error.message);
  return data as Event;
}
