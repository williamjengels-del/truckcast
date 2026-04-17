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
    // If the logged-in user is a manager, load the owner's profile + events instead
    const { data: myProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const effectiveUserId = (myProfile as Profile | null)?.owner_user_id ?? user.id;

    const [eventsResult, profileResult] = await Promise.all([
      supabase
        .from("events")
        .select("*")
        .eq("user_id", effectiveUserId)
        .order("event_date", { ascending: false }),
      // Load owner's profile for business name / city / tier
      effectiveUserId !== user.id
        ? supabase.from("profiles").select("*").eq("id", effectiveUserId).single()
        : Promise.resolve({ data: myProfile }),
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
