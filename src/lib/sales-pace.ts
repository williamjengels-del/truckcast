import type { Event } from "./database.types";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SBClient = any;

export type ComparableSource =
  | "name_and_venue" // Tier 1 — same event name AND same venue
  | "name" //          Tier 2 — same event name (any venue)
  | "venue"; //        Tier 3 — same venue (any event name)

export interface SalesComparable {
  avgSales: number;
  sampleCount: number;
  source: ComparableSource;
  /** Display label — what this comparable represents to the operator. */
  label: string;
}

/**
 * Find the historical comparable for a given event's day-of pace bar.
 *
 * Priority order (per spec §6):
 *   1. Same event_name + same location  -> "name_and_venue"
 *   2. Same event_name (any location)   -> "name"
 *   3. Same location (any event_name)   -> "venue"
 *
 * Each tier requires ≥ 1 prior event with non-null net_sales > 0
 * (zero-sales rows are treated as "no comparison" per spec edge case
 * "Comparable event has zero historical sales").
 *
 * Returns null if no tier matches — UI renders the "First time at
 * this event — no comparison yet" empty state.
 *
 * Excludes the current event row (id !=) and excludes cancellations
 * (cancellation_reason IS NULL). Excludes catering events because
 * they use invoice_revenue, not net_sales — comparing apples to
 * apples is the goal.
 *
 * RLS-scoped via user_id. Three sequential queries — could be
 * combined into one with a UNION but the priority semantics are
 * clearer as separate calls. With proper indexes (user_id + event_name)
 * each is cheap.
 */
export async function findSalesComparable(
  supabase: SBClient,
  userId: string,
  event: Pick<Event, "id" | "event_name" | "location" | "event_mode">
): Promise<SalesComparable | null> {
  // Catering events compare against invoice_revenue not net_sales —
  // out of v1 scope for the pace bar. Hide rather than mislead.
  if (event.event_mode === "catering") return null;

  const baseFilter = supabase
    .from("events")
    .select("net_sales", { count: "exact" })
    .eq("user_id", userId)
    .neq("id", event.id)
    .is("cancellation_reason", null)
    .neq("event_mode", "catering")
    .gt("net_sales", 0);

  // Tier 1: same name + same location.
  if (event.location) {
    const { data: t1 } = await baseFilter
      .eq("event_name", event.event_name)
      .eq("location", event.location);
    if (t1 && t1.length > 0) {
      const avg = average(t1.map((r: { net_sales: number }) => Number(r.net_sales)));
      return {
        avgSales: avg,
        sampleCount: t1.length,
        source: "name_and_venue",
        label: `${event.event_name} at ${event.location}`,
      };
    }
  }

  // Tier 2: same name (any venue).
  const { data: t2 } = await supabase
    .from("events")
    .select("net_sales")
    .eq("user_id", userId)
    .neq("id", event.id)
    .is("cancellation_reason", null)
    .neq("event_mode", "catering")
    .gt("net_sales", 0)
    .eq("event_name", event.event_name);
  if (t2 && t2.length > 0) {
    const avg = average(t2.map((r: { net_sales: number }) => Number(r.net_sales)));
    return {
      avgSales: avg,
      sampleCount: t2.length,
      source: "name",
      label: event.event_name,
    };
  }

  // Tier 3: same venue (any name).
  if (event.location) {
    const { data: t3 } = await supabase
      .from("events")
      .select("net_sales")
      .eq("user_id", userId)
      .neq("id", event.id)
      .is("cancellation_reason", null)
      .neq("event_mode", "catering")
      .gt("net_sales", 0)
      .eq("location", event.location);
    if (t3 && t3.length > 0) {
      const avg = average(t3.map((r: { net_sales: number }) => Number(r.net_sales)));
      return {
        avgSales: avg,
        sampleCount: t3.length,
        source: "venue",
        label: `events at ${event.location}`,
      };
    }
  }

  return null;
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
