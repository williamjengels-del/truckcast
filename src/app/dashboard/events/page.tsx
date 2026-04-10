import type { Metadata } from "next";
export const metadata: Metadata = { title: "Events" };

import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { EventsClient } from "./events-client";
import type { Event, Profile } from "@/lib/database.types";

async function EventsContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let events: Event[] = [];
  let profile: Profile | null = null;
  if (user) {
    const [eventsResult, profileResult] = await Promise.all([
      supabase
        .from("events")
        .select("*")
        .eq("user_id", user.id)
        .order("event_date", { ascending: false }),
      supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single(),
    ]);
    events = (eventsResult.data ?? []) as Event[];
    profile = (profileResult.data ?? null) as Profile | null;
  }

  return (
    <EventsClient
      initialEvents={events}
      userId={user?.id ?? ""}
      businessName={profile?.business_name ?? ""}
      userCity={profile?.city ?? ""}
    />
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24 text-muted-foreground text-sm">Loading events…</div>}>
      <EventsContent />
    </Suspense>
  );
}
