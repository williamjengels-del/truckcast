import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import { recalculateForUser } from "@/lib/recalculate";
import type { Profile } from "@/lib/database.types";

/**
 * POST /api/pos/toast/sync
 * Applies a parsed Toast email result to a specific event.
 * Updates net_sales and pos_source, then recalculates event performance.
 *
 * Body: { eventId: string, netSales: number }
 */
export async function POST(request: Request) {
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

    if (!profile || !hasAccess((profile as Profile).subscription_tier, "pos_integration")) {
      return NextResponse.json(
        { error: "POS integration requires a Pro or Premium subscription" },
        { status: 403 }
      );
    }

    const { eventId, netSales } = await request.json();

    if (!eventId || typeof netSales !== "number") {
      return NextResponse.json(
        { error: "eventId and netSales are required" },
        { status: 400 }
      );
    }

    // Verify the event belongs to this user
    const { data: event } = await supabase
      .from("events")
      .select("id, event_name, user_id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .single();

    if (!event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    // Update sales and mark source as toast
    const { error: updateError } = await supabase
      .from("events")
      .update({ net_sales: netSales, pos_source: "toast" })
      .eq("id", eventId)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Update last_sync metadata on the pos_connections row
    await supabase
      .from("pos_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_error: null,
      })
      .eq("user_id", user.id)
      .eq("provider", "toast");

    // Recalculate event performance
    await recalculateForUser(user.id);

    return NextResponse.json({ success: true, eventUpdated: event.event_name });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
