"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ContactFormData = {
  name: string;
  email?: string;
  phone?: string;
  /** Operator-facing label: "Company or event" — the affiliation. */
  organization?: string;
  /** Added 2026-05-11 — parallel to events.city / events.location. */
  city?: string;
  location?: string;
  notes?: string;
  /** Legacy soft-link kept for backward-compat during rollout. New form
   *  writes prefer linked_event_ids below. */
  linked_event_names?: string[];
  /** Real FK array to events.id. v1 — operator-curated. */
  linked_event_ids?: string[];
};

/**
 * Auto-merge duplicate contacts.
 * Strategy:
 *   1. Group by normalized email — exact duplicates.
 *   2. Then group remaining contacts by normalized name — likely duplicates.
 * The "primary" is whichever record has the most filled fields (or earliest created_at as tiebreak).
 * Merges linked_event_names and notes; deletes non-primary duplicates.
 * Returns { merged } — count of contacts removed.
 */
export async function deduplicateContacts(): Promise<{ merged: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  if (!contacts || contacts.length < 2) return { merged: 0 };

  // Helper: count filled fields (non-null, non-empty). Picks the
  // primary contact for merging — most-populated wins.
  function richness(c: Record<string, unknown>): number {
    return ["name", "email", "phone", "organization", "city", "location", "notes"].filter(
      (k) => c[k] != null && c[k] !== ""
    ).length;
  }

  // Helper: merge linked_event_names from many contacts into one array
  function mergeLinked(contacts: { linked_event_names: string[] | null }[]): string[] {
    const set = new Set<string>();
    for (const c of contacts) {
      for (const n of c.linked_event_names ?? []) set.add(n);
    }
    return [...set];
  }

  // Helper: merge linked_event_ids similarly. Different array so a
  // contact migrated to the new schema doesn't lose either dataset
  // during dedup.
  function mergeLinkedIds(contacts: { linked_event_ids: string[] | null }[]): string[] {
    const set = new Set<string>();
    for (const c of contacts) {
      for (const id of c.linked_event_ids ?? []) set.add(id);
    }
    return [...set];
  }

  // Helper: merge notes
  function mergeNotes(contacts: { notes: string | null }[]): string | null {
    const parts = contacts
      .map((c) => c.notes?.trim())
      .filter((n): n is string => !!n);
    const unique = [...new Set(parts)];
    return unique.length > 0 ? unique.join("\n---\n") : null;
  }

  const idsToDelete: string[] = [];
  const processed = new Set<string>();

  // Phase 1: Group by email
  const byEmail = new Map<string, typeof contacts>();
  for (const c of contacts) {
    if (!c.email) continue;
    const key = c.email.toLowerCase().trim();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(c);
  }

  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    // Sort: most filled fields first, then oldest created_at
    group.sort((a, b) => richness(b) - richness(a) || a.created_at.localeCompare(b.created_at));
    const primary = group[0];
    const duplicates = group.slice(1);

    await supabase
      .from("contacts")
      .update({
        linked_event_names: mergeLinked([primary, ...duplicates]),
        linked_event_ids: mergeLinkedIds([primary, ...duplicates]),
        notes: mergeNotes([primary, ...duplicates]),
        phone: primary.phone ?? duplicates.find((d) => d.phone)?.phone ?? null,
        organization: primary.organization ?? duplicates.find((d) => d.organization)?.organization ?? null,
        city: primary.city ?? duplicates.find((d) => d.city)?.city ?? null,
        location: primary.location ?? duplicates.find((d) => d.location)?.location ?? null,
      })
      .eq("id", primary.id)
      .eq("user_id", user.id);

    for (const dup of duplicates) {
      idsToDelete.push(dup.id);
      processed.add(dup.id);
    }
    processed.add(primary.id);
  }

  // Phase 2: Group remaining contacts by normalized name
  const remaining = contacts.filter((c) => !processed.has(c.id));
  const byName = new Map<string, typeof contacts>();
  for (const c of remaining) {
    if (!c.name) continue;
    const key = c.name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(c);
  }

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => richness(b) - richness(a) || a.created_at.localeCompare(b.created_at));
    const primary = group[0];
    const duplicates = group.slice(1);

    await supabase
      .from("contacts")
      .update({
        linked_event_names: mergeLinked([primary, ...duplicates]),
        linked_event_ids: mergeLinkedIds([primary, ...duplicates]),
        notes: mergeNotes([primary, ...duplicates]),
        email: primary.email ?? duplicates.find((d) => d.email)?.email ?? null,
        phone: primary.phone ?? duplicates.find((d) => d.phone)?.phone ?? null,
        organization: primary.organization ?? duplicates.find((d) => d.organization)?.organization ?? null,
        city: primary.city ?? duplicates.find((d) => d.city)?.city ?? null,
        location: primary.location ?? duplicates.find((d) => d.location)?.location ?? null,
      })
      .eq("id", primary.id)
      .eq("user_id", user.id);

    for (const dup of duplicates) idsToDelete.push(dup.id);
  }

  // Delete all duplicates in one call
  if (idsToDelete.length > 0) {
    await supabase
      .from("contacts")
      .delete()
      .in("id", idsToDelete)
      .eq("user_id", user.id);
  }

  revalidatePath("/dashboard/contacts");
  return { merged: idsToDelete.length };
}

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
    city: formData.city || null,
    location: formData.location || null,
    notes: formData.notes || null,
    linked_event_names: formData.linked_event_names ?? [],
    linked_event_ids: formData.linked_event_ids ?? [],
  });

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/contacts");
}

/**
 * Adds an event_id to a contact's linked_event_ids array, idempotently.
 * Called from the event form's contact autosuggest path — when an
 * operator picks a contact while creating/editing an event, the
 * forward-direction link is captured here.
 *
 * Uses ARRAY_APPEND + NULLIF dance via a SELECT + UPDATE rather than
 * a raw SQL function so the RLS policy can do its work (the operator
 * must own the contact). Returns true on success.
 */
export async function linkContactToEvent(
  contactId: string,
  eventId: string
): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Read current linked_event_ids
  const { data: contact, error: readError } = await supabase
    .from("contacts")
    .select("linked_event_ids")
    .eq("id", contactId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError || !contact) return false;

  const current = (contact as { linked_event_ids: string[] | null })
    .linked_event_ids ?? [];
  if (current.includes(eventId)) return true; // already linked, idempotent

  const next = [...current, eventId];
  const { error: updateError } = await supabase
    .from("contacts")
    .update({ linked_event_ids: next })
    .eq("id", contactId)
    .eq("user_id", user.id);
  if (updateError) return false;

  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/events");
  return true;
}

/**
 * Inverse of linkContactToEvent — removes an event_id from a contact's
 * linked_event_ids. Used when the operator un-picks a contact on the
 * event form.
 */
export async function unlinkContactFromEvent(
  contactId: string,
  eventId: string
): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contact } = await supabase
    .from("contacts")
    .select("linked_event_ids")
    .eq("id", contactId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!contact) return false;

  const current = (contact as { linked_event_ids: string[] | null })
    .linked_event_ids ?? [];
  const next = current.filter((id) => id !== eventId);
  if (next.length === current.length) return true; // already unlinked

  const { error } = await supabase
    .from("contacts")
    .update({ linked_event_ids: next })
    .eq("id", contactId)
    .eq("user_id", user.id);
  if (error) return false;

  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/events");
  return true;
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
