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
