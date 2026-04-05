import type { Metadata } from "next";
export const metadata: Metadata = { title: "Contacts" };

import { createClient } from "@/lib/supabase/server";
import { ContactsClient } from "./contacts-client";
import { hasAccess } from "@/lib/subscription";
import type { Contact, Profile } from "@/lib/database.types";

export default async function ContactsPage() {
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
    <ContactsClient
      initialContacts={contacts}
      isPremium={isPremium}
      availableEventNames={eventNames}
    />
  );
}
