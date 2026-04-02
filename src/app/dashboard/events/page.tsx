import { createClient } from "@/lib/supabase/server";
import { EventsClient } from "./events-client";
import type { Event } from "@/lib/database.types";

export default async function EventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let events: Event[] = [];
  if (user) {
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .order("event_date", { ascending: false });
    events = (data ?? []) as Event[];
  }

  return <EventsClient initialEvents={events} />;
}
