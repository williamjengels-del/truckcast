import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import { calculateOrganizerScore } from "@/lib/organizer-scoring";
import type { Profile } from "@/lib/database.types";

/**
 * POST /api/organizer-scoring
 * Recalculates quality scores for all contacts with linked event names.
 * Premium feature only.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !hasAccess((profile as Profile).subscription_tier, "organizer_scoring")
    ) {
      return NextResponse.json(
        { error: "Organizer quality scoring requires a Premium subscription" },
        { status: 403 }
      );
    }

    // Fetch all contacts with linked events
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, linked_event_names")
      .eq("user_id", user.id)
      .not("linked_event_names", "eq", "{}");

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    let updated = 0;

    for (const contact of contacts) {
      const linked = contact.linked_event_names as string[] | null;
      if (!linked || linked.length === 0) continue;

      const result = await calculateOrganizerScore(supabase, user.id, linked);
      if (!result) continue;

      await supabase
        .from("contacts")
        .update({ quality_score: result.score })
        .eq("id", contact.id)
        .eq("user_id", user.id);

      updated++;
    }

    return NextResponse.json({ updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/organizer-scoring?contactId=<uuid>
 * Returns the score breakdown for a single contact.
 * Premium feature only.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contactId");

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !hasAccess((profile as Profile).subscription_tier, "organizer_scoring")
    ) {
      return NextResponse.json(
        { error: "Organizer quality scoring requires a Premium subscription" },
        { status: 403 }
      );
    }

    if (!contactId) {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }

    const { data: contact } = await supabase
      .from("contacts")
      .select("id, linked_event_names")
      .eq("id", contactId)
      .eq("user_id", user.id)
      .single();

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const linked = contact.linked_event_names as string[] | null;
    if (!linked || linked.length === 0) {
      return NextResponse.json({ score: null, reason: "No linked events" });
    }

    const result = await calculateOrganizerScore(supabase, user.id, linked);
    return NextResponse.json(result ?? { score: null, reason: "Insufficient data" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
