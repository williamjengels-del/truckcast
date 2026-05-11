import type { Metadata } from "next";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { ContactsClient } from "./contacts-client";
import { ContactsTabBar } from "./contacts-tab-bar";
import { FollowersTab } from "./followers-tab";
import { hasAccess } from "@/lib/subscription";
import type { Contact, Profile } from "@/lib/database.types";

type ContactsTabKey = "organizers" | "followers";

function normalizeTab(raw: string | string[] | undefined): ContactsTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "followers") return "followers";
  return "organizers";
}

interface ContactsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ searchParams }: ContactsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);
  return { title: tab === "followers" ? "Contacts — Followers" : "Contacts" };
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  const scope = await resolveScopedSupabase();

  let contacts: Contact[] = [];
  let isPremium = false;
  // Events surface for the contact form's multi-select picker — needs
  // id + name + date so operators can disambiguate same-name events.
  // Pulled from the events table directly (not event_performance) so
  // newly-created events show up immediately, not after first recalc.
  let availableEvents: { id: string; name: string; date: string }[] = [];

  if (scope.kind !== "unauthorized") {
    const [{ data: contactsData }, { data: profile }, { data: eventsData }] =
      await Promise.all([
        scope.client
          .from("contacts")
          .select("*")
          .eq("user_id", scope.userId)
          .order("name", { ascending: true }),
        scope.client.from("profiles").select("subscription_tier").eq("id", scope.userId).single(),
        scope.client
          .from("events")
          .select("id, event_name, event_date")
          .eq("user_id", scope.userId)
          .order("event_date", { ascending: false }),
      ]);

    contacts = (contactsData ?? []) as Contact[];
    isPremium = hasAccess((profile as Profile)?.subscription_tier ?? "starter", "organizer_scoring");
    availableEvents = (eventsData ?? []).map((e) => ({
      id: e.id as string,
      name: e.event_name as string,
      date: e.event_date as string,
    }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Contacts</h1>
        <p className="text-muted-foreground text-sm">
          Organizers you book with and customers who follow your truck.
        </p>
      </div>

      <ContactsTabBar activeTab={tab} />

      <div className="pt-2">
        {tab === "organizers" && (
          <ContactsClient
            initialContacts={contacts}
            isPremium={isPremium}
            availableEvents={availableEvents}
          />
        )}
        {tab === "followers" && <FollowersTab />}
      </div>
    </div>
  );
}
