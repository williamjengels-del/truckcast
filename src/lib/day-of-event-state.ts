import type { Event } from "./database.types";
import { wallclockInZoneToUtcMs } from "./wallclock-tz";

export type DayOfDisplayKind =
  | "today" //    A still-active event today (with possibly more queued)
  | "tomorrow" // No active event today; tomorrow has one
  | "future" //   No active today, no tomorrow; next-closest event
  | "none"; //    Nothing scheduled going forward

export interface DayOfState {
  kind: DayOfDisplayKind;
  /** The event currently displayed as the "main" card. Null when kind === "none". */
  current: Event | null;
  /** Today events queued after `current` that haven't ended yet. Empty
   *  for non-"today" kinds. Used to render the "Up next today" stack. */
  upcomingToday: Event[];
  /** Today events whose end_time has passed (and were not the current
   *  picked one). Used to drive lazy auto_ended_at audit writes. */
  endedTodayIds: string[];
}

/**
 * Compute the display state for the day-of card given an operator's
 * event list, the operator-local "today" date, current time, and tz.
 *
 * Rules (per spec §11, §12):
 *   1. Pick the first today event that's still active. An event is
 *      "still active" iff:
 *        (a) auto_ended_at IS NULL
 *        (b) end_time is null OR end_time > now (in operator-local zone)
 *      No end_time = considered active until the operator marks it
 *      done — operators sometimes don't enter end times.
 *   2. If a current event exists, "upcoming today" = remaining today
 *      events that are also still active.
 *   3. If no active today: fall back to tomorrow's first booked event.
 *   4. If no tomorrow either: fall back to the next-closest booked
 *      event regardless of date.
 *   5. Returns ended-today IDs so the card can fire a lazy audit
 *      write to set auto_ended_at.
 *
 * Caller must pre-filter to bookedFuture (booked AND not cancelled
 * AND event_date >= today). Sort order is preserved: caller is
 * expected to sort by (event_date, start_time) ascending.
 */
export function computeDayOfState(
  bookedFuture: Event[],
  today: string,
  nowMs: number,
  timezone: string
): DayOfState {
  function endMs(e: Event): number | null {
    if (!e.end_time) return null;
    return wallclockInZoneToUtcMs(e.event_date, e.end_time, timezone);
  }
  function isStillActive(e: Event): boolean {
    if (e.auto_ended_at) return false;
    const m = endMs(e);
    if (m === null) return true; // missing end_time stays active
    return m > nowMs;
  }

  const todays = bookedFuture.filter((e) => e.event_date === today);
  const activeToday = todays.filter(isStillActive);
  const endedTodayIds = todays
    .filter(
      (e) =>
        !e.auto_ended_at &&
        e.end_time !== null &&
        endMs(e) !== null &&
        (endMs(e) as number) <= nowMs
    )
    .map((e) => e.id);

  if (activeToday.length > 0) {
    return {
      kind: "today",
      current: activeToday[0],
      upcomingToday: activeToday.slice(1),
      endedTodayIds,
    };
  }

  // Nothing live today. Fall through to the next future event.
  const futureNonToday = bookedFuture.filter((e) => e.event_date > today);
  const next = futureNonToday[0] ?? null;
  if (!next) {
    return {
      kind: "none",
      current: null,
      upcomingToday: [],
      endedTodayIds,
    };
  }

  // Tomorrow vs further-future label distinction.
  const tomorrow = addDaysInZone(today, 1, timezone);
  if (next.event_date === tomorrow) {
    return {
      kind: "tomorrow",
      current: next,
      upcomingToday: [],
      endedTodayIds,
    };
  }
  return {
    kind: "future",
    current: next,
    upcomingToday: [],
    endedTodayIds,
  };
}

/**
 * Add `days` calendar days to a YYYY-MM-DD string interpreted in the
 * given zone. Returns YYYY-MM-DD.
 *
 * We construct noon-local on the start date (avoiding DST edges that
 * land at midnight) and step forward N days.
 */
function addDaysInZone(date: string, days: number, zone: string): string {
  const noon = wallclockInZoneToUtcMs(date, "12:00", zone);
  if (noon === null) return date;
  const target = noon + days * 24 * 60 * 60 * 1000;
  // Format target back to YYYY-MM-DD in the operator's zone.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(target));
}
