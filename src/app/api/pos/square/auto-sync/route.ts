import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { fetchSquareOrders, refreshSquareToken } from "@/lib/pos/square";
import { aggregateByDate, matchAndUpdateSales, updateSyncStatus } from "@/lib/pos/sync";
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

      // Load operator's timezone for date attribution. Without this,
      // aggregateByDate falls back to its America/Chicago default —
      // PNW operators' late-night orders silently land on the wrong
      // day in cron, but on the right day for manual sync (which loads
      // profile.timezone). Surfaced 2026-05-08 deep-dive.
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("timezone")
        .eq("id", connection.user_id)
        .single();
      const operatorTimezone = profile?.timezone ?? "America/Chicago";

      // Fetch orders for yesterday
      const orders = await fetchSquareOrders(
        accessToken,
        locationIds,
        targetDate,
        targetDate
      );

      const dailySales = aggregateByDate(orders, { timeZone: operatorTimezone });

      const eventsUpdated = await matchAndUpdateSales(
        connection.user_id,
        dailySales,
        "square",
        { skipIfHasSales: true, supabase: serviceClient }
      );

      totalEventsUpdated += eventsUpdated;
      usersProcessed++;

      await updateSyncStatus(connection.id, "success", undefined, eventsUpdated, serviceClient);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push({ userId: connection.user_id, error: message });
      await updateSyncStatus(connection.id, "error", message, undefined, serviceClient);
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

