import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateSlug } from "@/lib/public-slug";

/**
 * PATCH /api/profile/public-slug
 *
 * Sets or updates the authenticated operator's public_slug on their
 * profiles row. Stage-1 surface for the custom-vendor-profile workstream
 * (v11 queue). No UI picker yet — this endpoint just exists so a UI
 * (or an admin doing a manual claim for an operator) can land a value.
 *
 * Body: { public_slug: string | null } — pass null to clear.
 *
 * Returns 400 on validation failure, 409 on uniqueness collision,
 * 403 on impersonation (operators shouldn't let an admin change their
 * branded URL), 401 when unauthenticated. On success, 200 with the
 * stored slug.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Impersonation block — the admin-mutation middleware should already
  // catch this, but belt-and-suspenders for a slug decision that reads
  // as "the operator's brand." updateSession's block only applies to
  // signed impersonation cookies hitting non-admin POST/PATCH routes;
  // this route IS non-admin PATCH so the block will fire upstream.
  // We add nothing here — just a note for future maintainers.

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const { public_slug: rawSlug } = body as { public_slug?: string | null };

  // Clearing the slug is always valid.
  if (rawSlug === null) {
    const { error } = await supabase
      .from("profiles")
      .update({ public_slug: null })
      .eq("id", user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ public_slug: null });
  }

  const validation = validateSlug(rawSlug);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  // Uniqueness check — do it app-side first so we can return a clean
  // 409 instead of a Postgres constraint violation. The DB unique index
  // is still the source of truth; this is a UX layer.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("public_slug", validation.slug)
    .maybeSingle();
  if (existing && existing.id !== user.id) {
    return NextResponse.json(
      { error: `"${validation.slug}" is already in use` },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ public_slug: validation.slug })
    .eq("id", user.id);
  if (error) {
    // Unique-violation race (someone else claimed the slug between our
    // SELECT and our UPDATE). Map to the same 409 for UX consistency.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `"${validation.slug}" was just claimed — try another` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ public_slug: validation.slug });
}
