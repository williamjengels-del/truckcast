import type { Metadata } from "next";
export const metadata: Metadata = { title: "Events" };

import { Suspense } from "react";
import { resolveScopedSupabase, canSeeFinancials } from "@/lib/dashboard-scope";
import { EventsClient } from "./events-client";
import { stripFinancialFields } from "@/lib/event-financials";
import type { Event, Profile, Contact } from "@/lib/database.types";

async function EventsContent() {
  // resolveScopedSupabase handles the manager/owner redirect (and
  // impersonation — 5c-i). scope.userId is always the id whose data
  // this page should render; scope.client is the right client for
  // reads (RLS-authed for self/manager, service-role for impersonation).
  const scope = await resolveScopedSupabase();

  let events: Event[] = [];
  let profile: Profile | null = null;
  let realUserId = "";
  let financialsVisible = true;
  let contacts: Contact[] = [];

  if (scope.kind !== "unauthorized") {
    realUserId = scope.realUserId;
    financialsVisible = canSeeFinancials(scope);
    const [eventsResult, profileResult, contactsResult] = await Promise.all([
      scope.client
        .from("events")
        .select("*")
        .eq("user_id", scope.userId)
        .order("event_date", { ascending: false }),
      scope.client.from("profiles").select("*").eq("id", scope.userId).single(),
      // Contacts surface for the inline event-card contact display.
      // One fetch up front, passed to client; the client builds an
      // event_id → contact map so per-row lookup is O(1) without N+1.
      scope.client
        .from("contacts")
        .select("id, name, email, phone, organization, city, location, linked_event_ids")
        .eq("user_id", scope.userId),
    ]);
    const rawEvents = (eventsResult.data ?? []) as Event[];
    // Manager without Financials access: strip dollar columns so the
    // existing client UI naturally renders nothing for them (fall-
    // through nulls already collapse the display) — defense-in-depth
    // alongside the explicit `canSeeFinancials` prop, which also hides
    // sales-entry CTAs that would otherwise render for null values.
    events = financialsVisible ? rawEvents : rawEvents.map(stripFinancialFields);
    profile = (profileResult.data ?? null) as Profile | null;
    contacts = (contactsResult.data ?? []) as Contact[];
  }

  return (
    <EventsClient
      initialEvents={events}
      userId={realUserId}
      businessName={profile?.business_name ?? ""}
      userCity={profile?.city ?? ""}
      userState={profile?.state ?? ""}
      canSeeFinancials={financialsVisible}
      contacts={contacts}
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
