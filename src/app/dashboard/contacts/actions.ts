"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ContactFormData = {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
};

export async function createContact(formData: ContactFormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("contacts").insert({
    user_id: user.id,
    name: formData.name,
    email: formData.email || null,
    phone: formData.phone || null,
    organization: formData.organization || null,
    notes: formData.notes || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/contacts");
}

export async function updateContact(
  id: string,
  formData: Partial<ContactFormData>
) {
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

  const { error } = await supabase
    .from("contacts")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/contacts");
}

export async function deleteContact(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/contacts");
}
