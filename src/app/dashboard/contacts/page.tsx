import { createClient } from "@/lib/supabase/server";
import { ContactsClient } from "./contacts-client";
import type { Contact } from "@/lib/database.types";

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let contacts: Contact[] = [];
  if (user) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", user.id)
      .order("name", { ascending: true });
    contacts = (data ?? []) as Contact[];
  }

  return <ContactsClient initialContacts={contacts} />;
}
