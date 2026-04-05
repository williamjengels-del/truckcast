"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { recalculateForUser } from "@/lib/recalculate";
import type { Event } from "@/lib/database.types";

export type EventFormData = {
  event_name: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  setup_time?: string;
  location?: string;
  city?: string;
  city_area?: string;
  latitude?: number;
  longitude?: number;
  booked?: boolean;
  is_private?: boolean;
  net_sales?: number;
  event_type?: string;
  event_tier?: string;
  event_weather?: string;
  anomaly_flag?: string;
  expected_attendance?: number;
  other_trucks?: number;
  fee_type?: string;
  fee_rate?: number;
  sales_minimum?: number;
  forecast_sales?: number;
  notes?: string;
  pos_source?: string;
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

  // Only include optional fields if they have values
  if (formData.start_time) insertData.start_time = formData.start_time;
  if (formData.end_time) insertData.end_time = formData.end_time;
  if (formData.setup_time) insertData.setup_time = formData.setup_time;
  if (formData.location) insertData.location = formData.location;
  if (formData.city) insertData.city = formData.city;
  if (formData.city_area) insertData.city_area = formData.city_area;
  if (formData.latitude) insertData.latitude = formData.latitude;
  if (formData.longitude) insertData.longitude = formData.longitude;
  if (formData.net_sales !== undefined && formData.net_sales !== null)
    insertData.net_sales = formData.net_sales;
  if (formData.event_type) insertData.event_type = formData.event_type;
  if (formData.event_tier) insertData.event_tier = formData.event_tier;
  if (formData.event_weather) insertData.event_weather = formData.event_weather;
  if (formData.anomaly_flag) insertData.anomaly_flag = formData.anomaly_flag;
  if (formData.expected_attendance)
    insertData.expected_attendance = formData.expected_attendance;
  if (formData.other_trucks !== undefined && formData.other_trucks !== null)
    insertData.other_trucks = formData.other_trucks;
  if (formData.fee_type) insertData.fee_type = formData.fee_type;
  if (formData.fee_rate !== undefined && formData.fee_rate !== null)
    insertData.fee_rate = formData.fee_rate;
  if (formData.sales_minimum !== undefined && formData.sales_minimum !== null)
    insertData.sales_minimum = formData.sales_minimum;
  if (formData.notes) insertData.notes = formData.notes;
  if (formData.pos_source) insertData.pos_source = formData.pos_source;

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
