import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import { fetchCloverOrders } from "@/lib/pos/clover";
import {
  aggregateByDate,
  matchAndUpdateSales,
  updateSyncStatus,
} from "@/lib/pos/sync";
import type { PosConnection, Profile } from "@/lib/database.types";

/**
 * POST /api/pos/clover/sync
 * Pulls yesterday's orders from Clover, matches to booked events, updates net_sales.
 * Can also be called with a JSON body { startDate, endDate } for custom ranges.
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

    // Check subscription tier (also grab timezone for date aggregation)
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, timezone")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !hasAccess((profile as Profile).subscription_tier, "pos_integration")
    ) {
      return NextResponse.json(
        { error: "POS integration requires Pro or Premium" },
        { status: 403 }
      );
    }

    // Get Clover connection
    const { data: connection } = await supabase
      .from("pos_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "clover")
      .single();

    if (!connection) {
      return NextResponse.json(
        { error: "No Clover connection found. Please connect Clover first." },
        { status: 404 }
      );
    }

    const conn = connection as PosConnection;

    if (!conn.sync_enabled) {
      return NextResponse.json(
        { error: "Clover sync is disabled" },
        { status: 400 }
      );
    }

    if (!conn.merchant_id) {
      await updateSyncStatus(conn.id, "error", "No merchant ID");
      return NextResponse.json(
        { error: "No Clover merchant ID found" },
        { status: 400 }
      );
    }

    // Determine date range
    let startDate: string;
    let endDate: string;

    try {
      const body = await request.json();
      startDate = body.startDate;
      endDate = body.endDate;
    } catch {
      // Default: yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday.toISOString().slice(0, 10);
      endDate = startDate;
    }

    // Fetch orders from Clover
    const orders = await fetchCloverOrders(
      conn.access_token,
      conn.merchant_id,
      startDate,
      endDate
    );

    // Aggregate by the user's local date and match to events
    const timeZone = (profile as Profile & { timezone?: string }).timezone ?? "America/Chicago";
    const dailySales = aggregateByDate(orders, { startDate, endDate, timeZone });
    const updatedCount = await matchAndUpdateSales(
      user.id,
      dailySales,
      "clover"
    );

    await updateSyncStatus(conn.id, "success");

    return NextResponse.json({
      success: true,
      ordersFound: orders.length,
      daysWithSales: dailySales.length,
      eventsUpdated: updatedCount,
      dateRange: { startDate, endDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    // Try to update sync status
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: conn } = await supabase
          .from("pos_connections")
          .select("id")
          .eq("user_id", user.id)
          .eq("provider", "clover")
          .single();
        if (conn) {
          await updateSyncStatus(conn.id, "error", message);
        }
      }
    } catch {
      // Best-effort status update
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
