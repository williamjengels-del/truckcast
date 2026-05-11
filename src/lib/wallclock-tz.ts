/**
 * Wall-clock-in-zone → UTC conversion.
 *
 * VendCast stores event_date as DATE and setup_time / start_time /
 * end_time as TIME (timezone-naive wall-clock). Combined with the
 * operator's profiles.timezone, that's an unambiguous instant — but
 * JavaScript's built-in Date constructors won't compute it correctly
 * when the server's TZ differs from the operator's.
 *
 *   new Date("2026-04-29T10:30:00")     -> server-local, wrong
 *   new Date("2026-04-29T10:30:00Z")    -> UTC, wrong
 *
 * The right answer needs DST-aware zone math. We don't pull
 * date-fns-tz; the algorithm below uses Intl.DateTimeFormat (which
 * IS DST-aware) to walk back to the correct UTC ms.
 *
 * Algorithm:
 *   1. Take the desired wall-clock and pretend it's UTC -> guess.
 *   2. Format that guess in the target zone -> observed wall-clock.
 *   3. Diff (desired - observed) -> the offset to subtract.
 *   4. guess + offset -> correct UTC ms.
 *
 * One pass is correct in normal time. During DST transitions the
 * single-pass diff lands within an hour of correct; a second pass
 * with the corrected guess removes that residual. Fall/winter
 * "double" hours (1:30 AM appearing twice) and spring "missing"
 * hours (2:30 AM not existing) get the later/earlier interpretation
 * respectively, which matches how operators talk about times near
 * those boundaries in practice.
 */

export function wallclockInZoneToUtcMs(
  date: string,
  time: string,
  zone: string
): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  const ss = Number(timeMatch[3] ?? "0");

  // Construct an Intl formatter once — reused for both passes.
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return null; // unrecognized zone string
  }

  const desiredUtc = Date.UTC(y, m - 1, d, hh, mm, ss);

  function offsetForGuess(guessUtcMs: number): number {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(guessUtcMs)).map((p) => [p.type, p.value])
    ) as Record<string, string>;
    // Intl can render "24" for hour in en-US with hour12:false at midnight;
    // normalize to 0 since Date.UTC interprets 24 as next-day.
    const observedHour = Number(parts.hour) % 24;
    const observedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      observedHour,
      Number(parts.minute),
      Number(parts.second)
    );
    return desiredUtc - observedAsUtc;
  }

  // Two passes converge during DST transitions. Standard time = first
  // pass is exact; second pass adds zero. DST = first pass lands an
  // hour off; second pass nails it.
  const firstOffset = offsetForGuess(desiredUtc);
  const guess = desiredUtc + firstOffset;
  const secondOffset = offsetForGuess(guess);
  return guess + secondOffset;
}

/**
 * Date string (YYYY-MM-DD) for the calendar date as it currently
 * appears in the target zone. Used by cron jobs to derive the
 * operator's "today" / "yesterday" / "tomorrow" without UTC drift.
 *
 * event_date is stored as a plain DATE (no time, no tz) and semantically
 * means "this date in the operator's local timezone." Comparing event_date
 * strings against a UTC-derived todayStr produces off-by-one errors for
 * non-UTC operators near midnight — sales-reminders for an event that
 * ended last night East-coast-time gets fired today UTC, or two days
 * later, depending on the cron schedule.
 *
 * Pass offsetDays to step forward/backward N days while staying in the
 * operator's zone (e.g., yesterday = localDateInZone(zone, -1)).
 *
 * Falls back to UTC if the zone string is unrecognized — defensive, so
 * a malformed profiles.timezone never crashes a cron. The fallback is
 * the prior behavior, so existing CT operators are unaffected even if
 * their profile is somehow missing a zone.
 */
export function localDateInZone(zone: string, offsetDays = 0): string {
  const now = new Date();
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // Unrecognized zone — fall back to UTC. Same as if the operator
    // never set a timezone; matches pre-this-helper behavior.
    return new Date(now.getTime() + offsetDays * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  // en-CA formats date as YYYY-MM-DD directly.
  const base = fmt.format(now); // e.g. "2026-05-11"
  if (offsetDays === 0) return base;

  // Add days by parsing back to a UTC-noon anchor + offset + reformat.
  // The noon anchor avoids DST-edge half-day issues (1am or 11pm in
  // the target zone won't roll across a date boundary mid-shift).
  const [y, m, d] = base.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0));
  return fmt.format(shifted);
}
