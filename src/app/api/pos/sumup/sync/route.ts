import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import {
  fetchSumUpTransactions,
  refreshSumUpToken,
  sumUpTokenExpiresAt,
} from "@/lib/pos/sumup";
import {
  aggregateByDate,
  matchAndUpdateSales,
  updateSyncStatus,
} from "@/lib/pos/sync";
import type { PosConnection, Profile } from "@/lib/database.types";

/**
 * POST /api/pos/sumup/sync
 * Pulls transactions from SumUp, aggregates by date, matches to booked events.
 * Accepts optional JSON body { startDate, endDate } for custom ranges.
 * Defaults to yesterday.
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

    const { data: connection } = await supabase
      .from("pos_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "sumup")
      .single();

    if (!connection) {
      return NextResponse.json(
        { error: "No SumUp connection found. Please connect SumUp first." },
        { status: 404 }
      );
    }

    const conn = connection as PosConnection;

    if (!conn.sync_enabled) {
      return NextResponse.json({ error: "SumUp sync is disabled" }, { status: 400 });
    }

    // Refresh token if expired (SumUp tokens expire in 1 hour)
    let accessToken = conn.access_token;
    if (conn.token_expires_at && new Date(conn.token_expires_at) <= new Date()) {
      if (!conn.refresh_token) {
        await updateSyncStatus(conn.id, "error", "Token expired — please reconnect SumUp");
        return NextResponse.json(
          { error: "Token expired. Please reconnect SumUp." },
          { status: 401 }
        );
      }

      const refreshed = await refreshSumUpToken(conn.refresh_token);
      accessToken = refreshed.access_token;

      await supabase
        .from("pos_connections")
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          token_expires_at: sumUpTokenExpiresAt(refreshed.expires_in),
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
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday.toISOString().slice(0, 10);
      endDate = startDate;
    }

    // Fetch transactions from SumUp
    const transactions = await fetchSumUpTransactions(
      accessToken,
      startDate,
      endDate
    );

    // Map SumUp's `date` field to the shape aggregateByDate expects
    const normalized = transactions.map((t) => ({
      createdAt: t.date,
      netSales: t.netSales,
    }));

    // Aggregate by the user's local date and match to events
    const timeZone = (profile as Profile & { timezone?: string }).timezone ?? "America/Chicago";
    const dailySales = aggregateByDate(normalized, { startDate, endDate, timeZone });
    const updatedCount = await matchAndUpdateSales(user.id, dailySales, "sumup");

    await updateSyncStatus(conn.id, "success");

    return NextResponse.json({
      success: true,
      transactionsFound: transactions.length,
      daysWithSales: dailySales.length,
      eventsUpdated: updatedCount,
      dateRange: { startDate, endDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: conn } = await supabase
          .from("pos_connections")
          .select("id")
          .eq("user_id", user.id)
          .eq("provider", "sumup")
          .single();
        if (conn) await updateSyncStatus(conn.id, "error", message);
      }
    } catch { /* best-effort */ }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
