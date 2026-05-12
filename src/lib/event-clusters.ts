import type { Event } from "@/lib/database.types";

/**
 * Multi-day cluster detection for the events list view.
 *
 * Groups events with the same event_name on TRULY CONSECUTIVE days
 * (gap = 1 day) into a "cluster" (e.g., Best of Missouri Festival
 * 3-day, Brentwood Days 2-day).
 *
 * NOTE: this is intentionally STRICTER than the forecast engine's
 * series-day filter (`forecast-engine.ts:SERIES_MAX_GAP_DAYS = 5`).
 * The engine uses a wide window because it benefits from a soft
 * "events in a series" signal even for festivals that skip a day.
 * The display clusterer is strict because anything wider chains
 * weekly recurring same-name events (Lunchtime Live Tue + Thu → next
 * Tue → next Thu all collapsed into one bogus "Day 1 of 4" cluster).
 * Decoupling the two values was the v54+ fix.
 *
 * Trade-off accepted: a festival that legitimately skips a day
 * (Fri + Sun, no Sat) splits into two clusters. Rare at Wok-O scale.
 * If this case appears in practice, the right fix is to persist
 * multi-day intent as a column populated by createMultiDayEvents,
 * not to widen this gap.
 *
 * v1 use: visual grouping in the events list (per-day badges + a
 * single cluster header above the first day). Festival-total
 * forecast aggregation also uses this map.
 *
 * The detection is pure on the event set — no DB lookups, no state.
 * Caller passes the events visible in the list; this returns a
 * Map<event_id, ClusterInfo> for O(1) per-row lookup during render.
 */

const MULTI_DAY_MAX_GAP_DAYS = 1;

export interface ClusterInfo {
  /** Stable id for the cluster — derived from the first event_id in
   *  date order. Stable enough for React keys; not persisted. */
  clusterId: string;
  /** Zero-indexed position of this event within the cluster (0-based
   *  by sorted date). Day-1 = index 0; rendered as "Day 1 of N" with
   *  +1 in display copy. */
  dayIndex: number;
  /** Total events in the cluster. Single-event "clusters" (i.e., not
   *  in a multi-day series) get totalDays=1 and are not surfaced as
   *  clusters in the UI — the caller treats totalDays>=2 as the
   *  "this is a multi-day event" signal. */
  totalDays: number;
  /** All event ids in this cluster, sorted ascending by date.
   *  Useful for the cluster-header component to sum forecasts. */
  allEventIds: string[];
  /** First (earliest) event date in the cluster — used by the header
   *  to render a range label like "May 3–5". */
  startDate: string;
  /** Last (latest) event date in the cluster. */
  endDate: string;
}

function daysBetween(a: string, b: string): number {
  const at = new Date(a + "T12:00:00Z").getTime();
  const bt = new Date(b + "T12:00:00Z").getTime();
  return Math.abs((bt - at) / 86400000);
}

/**
 * Build the cluster map. Pass any event list — typically the sorted
 * visible-in-list set. Returns a map keyed by event.id.
 *
 * Algorithm:
 *   1. Group events by normalized event_name (lowercase + trim).
 *   2. Within each name group, sort by date ascending.
 *   3. Walk the sorted dates; same-name events on truly consecutive
 *      days (gap = 1) form a cluster. Any larger gap starts a new
 *      cluster.
 *
 * Single-event "clusters" still appear in the map (totalDays=1) so
 * callers can simplify their lookup logic — render the cluster
 * header only when totalDays >= 2.
 */
export function detectMultiDayClusters(
  events: Event[]
): Map<string, ClusterInfo> {
  const byName = new Map<string, Event[]>();
  for (const e of events) {
    if (!e.event_name || !e.event_date) continue;
    const key = e.event_name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(e);
  }

  const out = new Map<string, ClusterInfo>();

  for (const group of byName.values()) {
    // Sort by date ascending; stable within same date.
    const sorted = [...group].sort((a, b) =>
      a.event_date.localeCompare(b.event_date)
    );

    let clusterStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const isLast = i === sorted.length;
      const gap = isLast
        ? Infinity
        : daysBetween(sorted[i - 1].event_date, sorted[i].event_date);

      // Close the current cluster when we hit a gap or end of group.
      if (gap > MULTI_DAY_MAX_GAP_DAYS) {
        const cluster = sorted.slice(clusterStart, i);
        const clusterId = cluster[0].id;
        // totalDays is the number of UNIQUE DATES in the cluster, not
        // the number of events. Two same-name events on the SAME date
        // are not a multi-day event — they're a same-day duplicate (or
        // two genuinely separate events with the same name). Either way
        // they shouldn't render the "Day 1 of 2" multi-day badge.
        // Fix shipped 2026-05-12 after operator caught two Graduation
        // Party rows on 5/31/26 rendering as a multi-day cluster.
        const uniqueDates = [
          ...new Set(cluster.map((e) => e.event_date)),
        ].sort();
        const totalDays = uniqueDates.length;
        const startDate = uniqueDates[0];
        const endDate = uniqueDates[uniqueDates.length - 1];
        const allEventIds = cluster.map((c) => c.id);

        cluster.forEach((e) => {
          // dayIndex now refers to position within unique-dates, not
          // position within the events list. Same-date duplicates share
          // a dayIndex.
          const dayIndex = uniqueDates.indexOf(e.event_date);
          out.set(e.id, {
            clusterId,
            dayIndex,
            totalDays,
            allEventIds,
            startDate,
            endDate,
          });
        });
        clusterStart = i;
      }
    }
  }

  return out;
}

/**
 * Display helper — pretty range label for a cluster header.
 * Same-month: "May 3–5". Cross-month: "May 30 – Jun 1".
 */
export function formatClusterDateRange(
  startISO: string,
  endISO: string
): string {
  const start = new Date(startISO + "T12:00:00Z");
  const end = new Date(endISO + "T12:00:00Z");
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  const monthFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (sameMonth) {
    const startStr = monthFmt.format(start);
    return `${startStr}–${end.getUTCDate()}`;
  }
  return `${monthFmt.format(start)} – ${monthFmt.format(end)}`;
}
