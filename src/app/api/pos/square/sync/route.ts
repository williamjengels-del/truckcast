import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import {
  fetchSquareOrders,
  refreshSquareToken,
} from "@/lib/pos/square";
import {
  aggregateByDate,
  matchAndUpdateSales,
  updateSyncStatus,
} from "@/lib/pos/sync";
import type { PosConnection, Profile } from "@/lib/database.types";

/**
 * POST /api/pos/square/sync
 * Pulls yesterday's orders from Square, matches to booked events, updates net_sales.
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

    // Get Square connection
    const { data: connection } = await supabase
      .from("pos_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "square")
      .single();

    if (!connection) {
      return NextResponse.json(
        { error: "No Square connection found. Please connect Square first." },
        { status: 404 }
      );
    }

    const conn = connection as PosConnection;

    if (!conn.sync_enabled) {
      return NextResponse.json(
        { error: "Square sync is disabled" },
        { status: 400 }
      );
    }

    // Refresh token if expired
    let accessToken = conn.access_token;
    if (
      conn.token_expires_at &&
      new Date(conn.token_expires_at) <= new Date()
    ) {
      if (!conn.refresh_token) {
        await updateSyncStatus(conn.id, "error", "Token expired and no refresh token");
        return NextResponse.json(
          { error: "Token expired. Please reconnect Square." },
          { status: 401 }
        );
      }

      const refreshed = await refreshSquareToken(conn.refresh_token);
      accessToken = refreshed.access_token;

      await supabase
        .from("pos_connections")
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          token_expires_at: refreshed.expires_at,
        })
        .eq("id", conn.id);
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

    // Fetch orders from Square
    const locationIds =
      conn.selected_location_ids.length > 0
        ? conn.selected_location_ids
        : conn.location_ids;

    if (locationIds.length === 0) {
      await updateSyncStatus(conn.id, "error", "No locations selected");
      return NextResponse.json(
        { error: "No Square locations selected" },
        { status: 400 }
      );
    }

    const orders = await fetchSquareOrders(
      accessToken,
      locationIds,
      startDate,
      endDate
    );

    // Separate invoice-sourced orders so they don't skew event sales data.
    // Invoice payments arrive on the payment date, not the event date, so
    // matching them by date would contaminate the wrong event's net_sales.
    const posOrders = orders.filter((o) => !o.isInvoice);
    const invoiceOrders = orders.filter((o) => o.isInvoice);
    const invoiceRevenueTotal = invoiceOrders.reduce((sum, o) => sum + o.netSales, 0);

    // Aggregate by the user's local date and filter to the requested range.
    // The Square query window is wider than the requested range to capture
    // late-night orders that cross midnight in UTC.
    const timeZone = (profile as Profile & { timezone?: string }).timezone ?? "America/Chicago";
    const dailySales = aggregateByDate(posOrders, { startDate, endDate, timeZone });
    const updatedCount = await matchAndUpdateSales(
      user.id,
      dailySales,
      "square"
    );

    await updateSyncStatus(conn.id, "success");

    return NextResponse.json({
      success: true,
      ordersFound: orders.length,
      posOrdersMatched: posOrders.length,
      invoiceOrdersExcluded: invoiceOrders.length,
      invoiceRevenueExcluded: Math.round(invoiceRevenueTotal * 100) / 100,
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
          .eq("provider", "square")
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
