import { NextResponse } from "next/server";
import { resolveScopedSupabase, canAccessPrep } from "@/lib/dashboard-scope";

// /api/prep
//
// Backs /dashboard/prep — three shared kitchen-state lists per
// operator (on_hand / to_prep / to_buy). Free-text items, simple
// done toggle.
//
// Access:
//   - Owner: always full access via RLS (user_id = auth.uid()).
//   - Manager: only when team_members.prep_access = true. RLS
//     enforces this at the DB layer; `canAccessPrep(scope)` is the
//     belt-and-suspenders application check that returns a clean
//     403 before the DB even rejects.
//
// Sections are an enum on the row; one table, one route, four
// verbs. No per-section endpoints to avoid the route-explosion
// shape we'd otherwise grow into.

const SECTIONS = ["on_hand", "to_prep", "to_buy"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(v: unknown): v is Section {
  return typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
}

// GET — return all items for the current dashboard scope, grouped by
// section client-side. Order: open items first (`done` ascending puts
// false before true), newest-created first within each group. Single
// payload keeps the page load to one round-trip.
export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessPrep(scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await scope.client
    .from("prep_items")
    .select(
      "id, section, text, done, created_at, updated_at, done_at, created_by, done_by"
    )
    .eq("user_id", scope.userId)
    .order("done", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

// POST — create a new item. Body: { section, text }.
export async function POST(request: Request) {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessPrep(scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const section = body.section;
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!isSection(section)) {
    return NextResponse.json(
      { error: "section must be one of: on_hand, to_prep, to_buy" },
      { status: 400 }
    );
  }
  if (!text) {
    return NextResponse.json(
      { error: "text required" },
      { status: 400 }
    );
  }
  if (text.length > 500) {
    return NextResponse.json(
      { error: "text too long (max 500 chars)" },
      { status: 400 }
    );
  }

  const { data, error } = await scope.client
    .from("prep_items")
    .insert({
      user_id: scope.userId,
      section,
      text,
      created_by: scope.realUserId,
    })
    .select(
      "id, section, text, done, created_at, updated_at, done_at, created_by, done_by"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

// PATCH — toggle done. Body: { id, done }.
// Intentionally narrow — no in-place text edits in v1; delete + add
// is the simpler shape. If operators ask for inline edit later, this
// route gets a `text` branch.
export async function PATCH(request: Request) {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessPrep(scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const done = typeof body.done === "boolean" ? body.done : null;
  if (!id || done === null) {
    return NextResponse.json(
      { error: "id and done required" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {
    done,
    updated_at: new Date().toISOString(),
  };
  if (done) {
    update.done_at = new Date().toISOString();
    update.done_by = scope.realUserId;
  } else {
    update.done_at = null;
    update.done_by = null;
  }

  const { data, error } = await scope.client
    .from("prep_items")
    .update(update)
    .eq("id", id)
    .eq("user_id", scope.userId)
    .select(
      "id, section, text, done, created_at, updated_at, done_at, created_by, done_by"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // .maybeSingle() returns null when the row doesn't exist or doesn't
  // match the user_id scope (vs .single() which would return a
  // PGRST116 error in that case). Surface as 404 so the client can
  // distinguish missing vs. genuine server error.
  if (!data) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ item: data });
}

// DELETE — remove an item. Body: { id }.
export async function DELETE(request: Request) {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessPrep(scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await scope.client
    .from("prep_items")
    .delete()
    .eq("id", id)
    .eq("user_id", scope.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
