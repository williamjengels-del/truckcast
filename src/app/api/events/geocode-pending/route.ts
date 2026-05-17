import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodeUserEvents } from "@/lib/geocode-events";

// POST /api/events/geocode-pending
//
// Geocodes the calling operator's events that have a location string
// but no cell_id — the gap that leaves imported historical data out of
// the cross-operator forecast match. Called by the self-serve CSV /
// Sheets import flow after its inserts land (the admin import route
// runs the same pass server-side in its own after() hook).
//
// Best-effort: only confident street-level geocodes get written, so a
// call that resolves nothing is a valid no-op. Runs against the
// operator's own RLS-scoped client — they can only touch their rows.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await geocodeUserEvents(user.id, supabase);
  return NextResponse.json(result);
}
