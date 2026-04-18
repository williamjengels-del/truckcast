import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Admin allowlist, keyed on auth user_id (not email).
//
// Why user_id:
//   - Email is mutable. Domain moves, account consolidations, and Supabase
//     email-change flows all mutate auth.users.email out from under us.
//   - user_id is the stable primary key.
//   - Pairs cleanly with an eventual `is_admin` column on profiles without
//     changing the call sites here.
//
// Human-readable reference:
//   7f97040f-023d-4604-8b66-f5aa321c31de = williamjengels@gmail.com
//   (Julian, Wok-O Taco — the only admin today)
export const ADMIN_USER_IDS = new Set<string>([
  "7f97040f-023d-4604-8b66-f5aa321c31de",
]);

export function isAdmin(user: { id: string } | null | undefined): boolean {
  return !!user && ADMIN_USER_IDS.has(user.id);
}

/**
 * Server-component guard. Resolves the current auth user, returns it if the
 * user is an admin, redirects to /dashboard otherwise. Call at the top of
 * any admin page.tsx that needs server-side enforcement.
 */
export async function requireAdmin(): Promise<User> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) {
    redirect("/dashboard");
  }
  return user!;
}

/**
 * API-route guard. Returns the admin user on success or null on failure.
 * API routes should branch on null and return a 403 — we don't redirect
 * from JSON endpoints.
 *
 *   const admin = await getAdminUser();
 *   if (!admin) return Response.json({ error: "Forbidden" }, { status: 403 });
 */
export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return isAdmin(user) ? user : null;
}
