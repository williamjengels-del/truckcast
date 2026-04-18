import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let contacts: Contact[] = [];
  let isPremium = false;
  let eventNames: string[] = [];

  if (user) {
    const [{ data: contactsData }, { data: profile }, { data: eventsData }] =
      await Promise.all([
        supabase
          .from("contacts")
          .select("*")
          .eq("user_id", user.id)
          .order("name", { ascending: true }),
        supabase.from("profiles").select("subscription_tier").eq("id", user.id).single(),
        supabase
          .from("event_performance")
          .select("event_name")
          .eq("user_id", user.id)
          .order("event_name"),
      ]);

    contacts = (contactsData ?? []) as Contact[];
    isPremium = hasAccess((profile as Profile)?.subscription_tier ?? "starter", "organizer_scoring");
    eventNames = (eventsData ?? []).map((e) => e.event_name as string);
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
            availableEventNames={eventNames}
          />
        )}
        {tab === "followers" && <FollowersTab />}
      </div>
    </div>
  );
}
