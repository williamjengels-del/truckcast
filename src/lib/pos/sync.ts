/**
 * Shared POS sync utilities.
 *
 * Matches POS order totals to booked events by date and updates net_sales,
 * then triggers event performance recalculation.
 */

import { createClient } from "@/lib/supabase/server";
import { recalculateForUser } from "@/lib/recalculate";
import type { PosSource } from "@/lib/database.types";

export interface DailySalesAggregate {
  date: string; // YYYY-MM-DD
  netSales: number; // in dollars, already converted from cents
}

/**
 * Aggregate order-level sales into per-day totals.
 */
export function aggregateByDate(
  orders: { createdAt: string; netSales: number }[]
): DailySalesAggregate[] {
  const map = new Map<string, number>();

  for (const order of orders) {
    const date = order.createdAt.slice(0, 10); // YYYY-MM-DD
    map.set(date, (map.get(date) ?? 0) + order.netSales);
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
 * Returns the number of events updated.
 */
export async function matchAndUpdateSales(
  userId: string,
  dailySales: DailySalesAggregate[],
  provider: PosSource
): Promise<number> {
  const supabase = await createClient();
  let updatedCount = 0;

  for (const { date, netSales } of dailySales) {
    // Find booked events for this user on this date
    const { data: events } = await supabase
      .from("events")
      .select("id, event_name, forecast_sales, net_sales, pos_source")
      .eq("user_id", userId)
      .eq("event_date", date)
      .eq("booked", true);

    if (!events || events.length === 0) continue;

    if (events.length === 1) {
      // Single event on this date — assign full total
      const event = events[0];
      const existingSource = event.pos_source as PosSource;
      const newSource: PosSource =
        existingSource !== "manual" && existingSource !== provider
          ? "mixed"
          : provider;

      await supabase
        .from("events")
        .update({
          net_sales: netSales,
          pos_source: newSource,
        })
        .eq("id", event.id);

      updatedCount++;
    } else {
      // Multiple events — split by forecast or equally
      const totalForecast = events.reduce(
        (sum, e) => sum + (e.forecast_sales ?? 0),
        0
      );
      const useForecast = totalForecast > 0;

      for (const event of events) {
        let share: number;
        if (useForecast && event.forecast_sales) {
          share = (event.forecast_sales / totalForecast) * netSales;
        } else {
          share = netSales / events.length;
        }

        const existingSource = event.pos_source as PosSource;
        const newSource: PosSource =
          existingSource !== "manual" && existingSource !== provider
            ? "mixed"
            : provider;

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

  // Trigger recalculation after sales updates
  if (updatedCount > 0) {
    await recalculateForUser(userId);
  }

  return updatedCount;
}

/**
 * Update the sync status on a POS connection record.
 */
export async function updateSyncStatus(
  connectionId: string,
  status: "success" | "error",
  error?: string
): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("pos_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: status === "error" ? (error ?? "Unknown error") : null,
    })
    .eq("id", connectionId);
}
