/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DO NOT USE THESE HELPERS ON CALENDAR DATE COLUMNS.              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║                                                                  ║
 * ║  Calendar DATE columns (events.event_date, daily aggregates,     ║
 * ║  etc.) represent a calendar day with no time component —         ║
 * ║  "April 19" as an event date means April 19 regardless of        ║
 * ║  where the viewer sits on the globe.                             ║
 * ║                                                                  ║
 * ║  Passing an event_date through formatDate() in this module       ║
 * ║  would convert it through the viewer's timezone and potentially  ║
 * ║  SHIFT THE DAY. A "2025-04-19" event stored as the string        ║
 * ║  "2025-04-19" would be parsed at UTC midnight, then rendered in  ║
 * ║  the viewer's local tz — which for Central (UTC-5/-6) would      ║
 * ║  show as "Apr 18". Catastrophic for scheduling correctness.      ║
 * ║                                                                  ║
 * ║  For calendar DATE rendering, either:                            ║
 * ║    (a) Render the ISO string directly, OR                        ║
 * ║    (b) Parse as LOCAL midnight:                                  ║
 * ║          new Date(isoDateStr + "T00:00:00")                      ║
 * ║        then call .toLocaleDateString(). This is the existing     ║
 * ║        convention in events-client.tsx, events-admin-table.tsx,  ║
 * ║        and events-page-client.tsx. DO NOT CONSOLIDATE THOSE      ║
 * ║        HERE without adding a separate formatCalendarDate()       ║
 * ║        helper that explicitly skips the tz conversion.           ║
 * ║                                                                  ║
 * ║  The helpers below are CORRECT for TIMESTAMPTZ values only.      ║
 * ║  TIMESTAMPTZ + viewer tz conversion is what we want — a signup   ║
 * ║  at 2am UTC SHOULD show as the previous day in Central, because  ║
 * ║  that's when the user locally experienced the signup.            ║
 * ║                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * All helpers render in the viewer's browser timezone. Intl.DateTimeFormat
 * uses `undefined` as the locale argument to pick up the browser default.
 * The DB stores UTC; these helpers convert at render only.
 */

type TimeInput = Date | string | null | undefined;

function toDate(value: TimeInput): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Full datetime with timezone abbreviation.
 * Example: "Apr 19, 2026 at 6:34 PM CDT"
 * Use for: audit logs, activity feeds where exact moment matters.
 */
export function formatTimestamp(
  value: TimeInput,
  options?: { fallback?: string }
): string {
  const d = toDate(value);
  if (!d) return options?.fallback ?? "—";
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${datePart} at ${timePart}`;
}

/**
 * Compact datetime for dense tables, no year, no tz abbreviation.
 * Example: "Apr 19, 6:34 PM"
 * Use for: row-level columns in wide tables where column width is
 * at a premium. Not currently called from any admin surface — kept
 * exported for future use (notifications panel, bookings inbox).
 */
export function formatTimestampShort(value: TimeInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Date only, timezone-aware. For TIMESTAMPTZ values rendered as date
 * (e.g. created_at shown as "Apr 19, 2026"). Converts the UTC
 * timestamp into the viewer's timezone first, so a 2am UTC event in
 * Central time shows as the previous day — which is when the user
 * actually experienced it.
 *
 * DO NOT use for events.event_date — see the warning block at the top
 * of this file.
 *
 * Example: "Apr 19, 2026"
 */
export function formatDate(
  value: TimeInput,
  options?: { fallback?: string; includeYear?: boolean }
): string {
  const d = toDate(value);
  if (!d) return options?.fallback ?? "—";
  return d.toLocaleDateString(undefined, {
    year: options?.includeYear === false ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Relative time expression for feeds.
 * Example: "2 hours ago", "3 days ago", "now"
 * Future timestamps render as "in 2 hours".
 * Not currently called from any admin surface — kept exported for
 * future use (notifications panel, activity card in bookings inbox).
 */
export function formatRelativeTime(value: TimeInput): string {
  const d = toDate(value);
  if (!d) return "—";
  const diffMs = d.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const sign = diffMs < 0 ? -1 : 1;

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  if (absMs < MIN) return rtf.format(0, "second");
  if (absMs < HOUR) return rtf.format(sign * Math.round(absMs / MIN), "minute");
  if (absMs < DAY) return rtf.format(sign * Math.round(absMs / HOUR), "hour");
  if (absMs < WEEK) return rtf.format(sign * Math.round(absMs / DAY), "day");
  if (absMs < MONTH) return rtf.format(sign * Math.round(absMs / WEEK), "week");
  if (absMs < YEAR) return rtf.format(sign * Math.round(absMs / MONTH), "month");
  return rtf.format(sign * Math.round(absMs / YEAR), "year");
}
