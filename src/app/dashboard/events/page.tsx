import type { Metadata } from "next";
export const metadata: Metadata = { title: "Events" };

import { Suspense } from "react";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { EventsClient } from "./events-client";
import type { Event, Profile } from "@/lib/database.types";

async function EventsContent() {
  // resolveScopedSupabase handles the manager/owner redirect (and
  // impersonation — 5c-i). scope.userId is always the id whose data
  // this page should render; scope.client is the right client for
  // reads (RLS-authed for self/manager, service-role for impersonation).
  const scope = await resolveScopedSupabase();

  let events: Event[] = [];
  let profile: Profile | null = null;
  let realUserId = "";

  if (scope.kind !== "unauthorized") {
    realUserId = scope.realUserId;
    const [eventsResult, profileResult] = await Promise.all([
      scope.client
        .from("events")
        .select("*")
        .eq("user_id", scope.userId)
        .order("event_date", { ascending: false }),
      scope.client.from("profiles").select("*").eq("id", scope.userId).single(),
    ]);
    events = (eventsResult.data ?? []) as Event[];
    profile = (profileResult.data ?? null) as Profile | null;
  }

  return (
    <EventsClient
      initialEvents={events}
      userId={realUserId}
      businessName={profile?.business_name ?? ""}
      userCity={profile?.city ?? ""}
      userState={profile?.state ?? ""}
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
