/**
 * Shared POS sync utilities.
 *
 * Matches POS order totals to booked events by date and updates net_sales,
 * then triggers event performance recalculation.
 */

import { createClient } from "@/lib/supabase/server";
import { recalculateForUser } from "@/lib/recalculate";
import { recalculateForUserWithClient } from "@/lib/recalculate-service";
import type { PosSource } from "@/lib/database.types";

export interface DailySalesAggregate {
  date: string; // YYYY-MM-DD
  netSales: number; // in dollars, already converted from cents
}

export interface MatchAndUpdateOptions {
  /** Skip events that already have net_sales > 0. Used by cron to preserve manual entries. */
  skipIfHasSales?: boolean;
  /** Service-role Supabase client. When provided, bypasses cookie auth (used in cron/webhooks). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

/**
 * Aggregate order-level sales into per-day totals.
 *
 * Square timestamps are UTC. Food trucks often operate in the evening, so
 * a naive UTC slice (createdAt.slice(0, 10)) will attribute late-night orders
 * to the wrong calendar date. We convert to the merchant's local timezone
 * before grouping, then optionally filter to the requested date range.
 *
 * Default timezone: America/Chicago (covers most US food trucks). Users can
 * override this with a profile timezone field in the future.
 */
export function aggregateByDate(
  orders: { createdAt: string; netSales: number }[],
  options: {
    timeZone?: string;
    startDate?: string; // YYYY-MM-DD inclusive filter
    endDate?: string;   // YYYY-MM-DD inclusive filter
  } = {}
): DailySalesAggregate[] {
  const { timeZone = "America/Chicago", startDate, endDate } = options;
  const map = new Map<string, number>();

  for (const order of orders) {
    // Convert UTC timestamp to local calendar date in the merchant's timezone.
    // en-CA gives YYYY-MM-DD format natively.
    const localDate = new Date(order.createdAt).toLocaleDateString("en-CA", {
      timeZone,
    });

    // If a date range filter is provided, skip orders that fall outside it.
    if (startDate && localDate < startDate) continue;
    if (endDate && localDate > endDate) continue;

    map.set(localDate, (map.get(localDate) ?? 0) + order.netSales);
  }

  return Array.from(map.entries()).map(([date, netSales]) => ({
    date,
    netSales: Math.round(netSales * 100) / 100,
  }));
}

/**
 * Match daily POS sales to booked events for a user and update their net_sales.
 *
 * Strategy:
 * - For each day in the aggregate, find booked events on that date.
 * - If exactly one event on that date, assign the full daily total.
 * - If multiple events on the same date, split proportionally by forecast
 *   (or equally if no forecasts exist).
 * - Updates pos_source on the event to the given provider.
 * - Triggers recalculation after all updates.
 *
 * Pass options.skipIfHasSales=true (cron) to skip events with existing sales.
 * Pass options.supabase (service client) when calling from cron/webhooks.
 *
 * Returns the number of events updated.
 */
export async function matchAndUpdateSales(
  userId: string,
  dailySales: DailySalesAggregate[],
  provider: PosSource,
  options: MatchAndUpdateOptions = {}
): Promise<number> {
  const { skipIfHasSales = false, supabase: serviceClient } = options;
  const supabase = serviceClient ?? (await createClient());
  let updatedCount = 0;

  for (const { date, netSales } of dailySales) {
    const { data: events } = await supabase
      .from("events")
      .select("id, event_name, forecast_sales, net_sales, pos_source")
      .eq("user_id", userId)
      .eq("event_date", date)
      .eq("booked", true);

    if (!events || events.length === 0) continue;

    // Two-layer eligibility filter:
    //   1. Cron mode: skip events that already have non-zero sales
    //      (preserves any prior sync's value).
    //   2. ALWAYS: skip events whose pos_source is "manual" — operator
    //      explicitly entered the value and the no-auto-fix-on-operator-
    //      data memory rule says POS sync MUST NOT clobber it. Past Cowork
    //      Airtable time destruction is the precedent. Without this check
    //      every manual sync would silently overwrite operator edits.
    const eligibleEvents = events.filter(
      (e: { net_sales: number | null; pos_source: string | null }) => {
        if (e.pos_source === "manual" && e.net_sales !== null) return false;
        if (skipIfHasSales && e.net_sales !== null && e.net_sales !== 0) return false;
        return true;
      }
    );

    if (eligibleEvents.length === 0) continue;

    if (eligibleEvents.length === 1) {
      const event = eligibleEvents[0];
      const existingSource = event.pos_source as PosSource;
      const newSource: PosSource =
        existingSource !== "manual" && existingSource !== provider ? "mixed" : provider;

      await supabase
        .from("events")
        .update({ net_sales: netSales, pos_source: newSource })
        .eq("id", event.id);

      updatedCount++;
    } else {
      // Multiple events — split by forecast or equally
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

        const existingSource = event.pos_source as PosSource;
        const newSource: PosSource =
          existingSource !== "manual" && existingSource !== provider ? "mixed" : provider;

        await supabase
          .from("events")
          .update({
            net_sales: Math.round(share * 100) / 100,
            pos_source: newSource,
          })
          .eq("id", event.id);

        updatedCount++;
      }
    }
  }

  if (updatedCount > 0) {
    if (serviceClient) {
      await recalculateForUserWithClient(userId, serviceClient);
    } else {
      await recalculateForUser(userId);
    }
  }

  return updatedCount;
}

/**
 * Update the sync status on a POS connection record.
 */
export async function updateSyncStatus(
  connectionId: string,
  status: "success" | "error",
  error?: string,
  eventsUpdated?: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient?: any
): Promise<void> {
  const supabase = serviceClient ?? (await createClient());

  await supabase
    .from("pos_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: status === "error" ? (error ?? "Unknown error") : null,
      ...(eventsUpdated !== undefined ? { last_sync_events_updated: eventsUpdated } : {}),
    })
    .eq("id", connectionId);
}
