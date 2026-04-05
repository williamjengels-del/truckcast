import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  fetchSquareOrders,
  refreshSquareToken,
} from "@/lib/pos/square";
import {
  aggregateByDate,
  matchAndUpdateSales,
} from "@/lib/pos/sync";
import type { PosConnection } from "@/lib/database.types";

/**
 * GET /api/pos/square/auto-sync
 * Called by Vercel cron daily at 9 AM Central (14:00 UTC).
 * Syncs yesterday's Square orders for all connected users.
 *
 * Can also be called with ?userId=<id> to sync a single user (used by
 * the "Sync Now" button in POS settings, which still uses POST /api/pos/square/sync
 * for user-scoped syncs — this route supports a single-user shortcut for cron
 * restarts and admin testing).
 */
export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Compute yesterday in YYYY-MM-DD
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = yesterday.toISOString().slice(0, 10);

  // Optional single-user override
  const singleUserId = new URL(request.url).searchParams.get("userId");

  // Fetch all active Square connections (with sync enabled)
  let query = serviceClient
    .from("pos_connections")
    .select("*")
    .eq("provider", "square")
    .eq("sync_enabled", true);

  if (singleUserId) {
    query = query.eq("user_id", singleUserId);
  }

  const { data: connections, error: connError } = await query;

  if (connError) {
    return NextResponse.json(
      { error: `Failed to load connections: ${connError.message}` },
      { status: 500 }
    );
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({
      success: true,
      usersProcessed: 0,
      eventsUpdated: 0,
      date: targetDate,
    });
  }

  let usersProcessed = 0;
  let totalEventsUpdated = 0;
  const errors: { userId: string; error: string }[] = [];

  for (const connection of connections as PosConnection[]) {
    try {
      let accessToken = connection.access_token;

      // Refresh token if expired
      if (
        connection.token_expires_at &&
        new Date(connection.token_expires_at) <= new Date()
      ) {
        if (!connection.refresh_token) {
          await serviceClient
            .from("pos_connections")
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: "error",
              last_sync_error: "Token expired and no refresh token available",
            })
            .eq("id", connection.id);
          errors.push({
            userId: connection.user_id,
            error: "Token expired, no refresh token",
          });
          continue;
        }

        const refreshed = await refreshSquareToken(connection.refresh_token);
        accessToken = refreshed.access_token;

        await serviceClient
          .from("pos_connections")
          .update({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
            token_expires_at: refreshed.expires_at,
          })
          .eq("id", connection.id);
      }

      const locationIds =
        connection.selected_location_ids.length > 0
          ? connection.selected_location_ids
          : connection.location_ids;

      if (locationIds.length === 0) {
        errors.push({ userId: connection.user_id, error: "No locations selected" });
        continue;
      }

      // Fetch orders for yesterday
      const orders = await fetchSquareOrders(
        accessToken,
        locationIds,
        targetDate,
        targetDate
      );

      const dailySales = aggregateByDate(orders);

      // Only update events where net_sales is null or 0
      // matchAndUpdateSales handles the skip-if-manual logic via pos_source check,
      // but we add an extra guard: only pass days where the event has no sales yet.
      // We filter dailySales to only dates where at least one event has no net_sales.
      const { data: userEvents } = await serviceClient
        .from("events")
        .select("id, event_date, net_sales, booked")
        .eq("user_id", connection.user_id)
        .eq("booked", true)
        .eq("event_date", targetDate);

      const hasUnsyncedEvent = (userEvents ?? []).some(
        (e) => e.net_sales === null || e.net_sales === 0
      );

      if (!hasUnsyncedEvent) {
        // All events for this day already have sales — skip to preserve manual entries
        usersProcessed++;
        await serviceClient
          .from("pos_connections")
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: "success",
            last_sync_error: null,
            last_sync_events_updated: 0,
          })
          .eq("id", connection.id);
        continue;
      }

      // Use matchAndUpdateSales but only for events without existing net_sales
      // We implement the "skip if already has value" logic by filtering events
      const eventsUpdated = await matchAndUpdateSalesSkipExisting(
        connection.user_id,
        dailySales,
        "square",
        serviceClient
      );

      totalEventsUpdated += eventsUpdated;
      usersProcessed++;

      await serviceClient
        .from("pos_connections")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "success",
          last_sync_error: null,
          last_sync_events_updated: eventsUpdated,
        })
        .eq("id", connection.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push({ userId: connection.user_id, error: message });

      await serviceClient
        .from("pos_connections")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "error",
          last_sync_error: message,
        })
        .eq("id", connection.id);
    }
  }

  return NextResponse.json({
    success: true,
    date: targetDate,
    usersProcessed,
    totalEventsUpdated,
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * Variant of matchAndUpdateSales that skips events which already have net_sales > 0.
 * Uses service role client to operate across users.
 */
async function matchAndUpdateSalesSkipExisting(
  userId: string,
  dailySales: { date: string; netSales: number }[],
  provider: "square",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: any
): Promise<number> {
  const { recalculateForUserWithClient } = await import("@/lib/recalculate-service");
  let updatedCount = 0;

  for (const { date, netSales } of dailySales) {
    const { data: events } = await serviceClient
      .from("events")
      .select("id, event_name, forecast_sales, net_sales, pos_source")
      .eq("user_id", userId)
      .eq("event_date", date)
      .eq("booked", true);

    if (!events || events.length === 0) continue;

    // Filter to only events without existing net_sales (skip manual entries)
    const eligibleEvents = events.filter(
      (e: { net_sales: number | null }) => e.net_sales === null || e.net_sales === 0
    );

    if (eligibleEvents.length === 0) continue;

    if (eligibleEvents.length === 1) {
      await serviceClient
        .from("events")
        .update({ net_sales: netSales, pos_source: provider })
        .eq("id", eligibleEvents[0].id);
      updatedCount++;
    } else {
      // Split proportionally by forecast or equally
      const totalForecast = eligibleEvents.reduce(
        (sum: number, e: { forecast_sales: number | null }) => sum + (e.forecast_sales ?? 0),
        0
      );
      const useForecast = totalForecast > 0;

      for (const event of eligibleEvents) {
        let share: number;
        if (useForecast && event.forecast_sales) {
          share = (event.forecast_sales / totalForecast) * netSales;
        } else {
          share = netSales / eligibleEvents.length;
        }

        await serviceClient
          .from("events")
          .update({
            net_sales: Math.round(share * 100) / 100,
            pos_source: provider,
          })
          .eq("id", event.id);

        updatedCount++;
      }
    }
  }

  if (updatedCount > 0) {
    await recalculateForUserWithClient(userId, serviceClient);
  }

  return updatedCount;
}
