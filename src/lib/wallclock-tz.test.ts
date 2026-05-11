import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { wallclockInZoneToUtcMs, localDateInZone } from "./wallclock-tz";

describe("wallclockInZoneToUtcMs", () => {
  it("returns the correct UTC ms for CDT (summer, UTC-5)", () => {
    // 2026-04-29 11:30 AM CDT = 2026-04-29 16:30 UTC
    const got = wallclockInZoneToUtcMs("2026-04-29", "11:30", "America/Chicago");
    expect(got).toBe(Date.UTC(2026, 3, 29, 16, 30, 0));
  });

  it("returns the correct UTC ms for CST (winter, UTC-6)", () => {
    // 2026-01-15 11:30 AM CST = 2026-01-15 17:30 UTC
    const got = wallclockInZoneToUtcMs("2026-01-15", "11:30", "America/Chicago");
    expect(got).toBe(Date.UTC(2026, 0, 15, 17, 30, 0));
  });

  it("handles spring-forward DST boundary (2026-03-08, fall back into DST)", () => {
    // 11:30 AM CDT on 2026-03-08 = 16:30 UTC (after DST starts at 2 AM CST)
    const got = wallclockInZoneToUtcMs("2026-03-08", "11:30", "America/Chicago");
    expect(got).toBe(Date.UTC(2026, 2, 8, 16, 30, 0));
  });

  it("handles fall-back DST boundary (2026-11-01)", () => {
    // 11:30 AM CST on 2026-11-01 = 17:30 UTC (after DST ends at 2 AM CDT)
    const got = wallclockInZoneToUtcMs("2026-11-01", "11:30", "America/Chicago");
    expect(got).toBe(Date.UTC(2026, 10, 1, 17, 30, 0));
  });

  it("handles America/Los_Angeles correctly", () => {
    // 2026-07-15 9:00 AM PDT = 16:00 UTC
    const got = wallclockInZoneToUtcMs("2026-07-15", "09:00", "America/Los_Angeles");
    expect(got).toBe(Date.UTC(2026, 6, 15, 16, 0, 0));
  });

  it("handles America/New_York correctly", () => {
    // 2026-07-15 9:00 AM EDT = 13:00 UTC
    const got = wallclockInZoneToUtcMs("2026-07-15", "09:00", "America/New_York");
    expect(got).toBe(Date.UTC(2026, 6, 15, 13, 0, 0));
  });

  it("handles UTC zone passthrough", () => {
    const got = wallclockInZoneToUtcMs("2026-04-29", "11:30", "UTC");
    expect(got).toBe(Date.UTC(2026, 3, 29, 11, 30, 0));
  });

  it("handles HH:MM:SS (Postgres TIME with seconds)", () => {
    const got = wallclockInZoneToUtcMs("2026-04-29", "11:30:45", "America/Chicago");
    expect(got).toBe(Date.UTC(2026, 3, 29, 16, 30, 45));
  });

  it("returns null for malformed date", () => {
    expect(wallclockInZoneToUtcMs("not-a-date", "11:30", "America/Chicago")).toBeNull();
  });

  it("returns null for malformed time", () => {
    expect(wallclockInZoneToUtcMs("2026-04-29", "ten thirty", "America/Chicago")).toBeNull();
  });

  it("returns null for unknown timezone", () => {
    expect(wallclockInZoneToUtcMs("2026-04-29", "11:30", "Mars/Olympus_Mons")).toBeNull();
  });

  it("handles late-night that crosses to next-day UTC", () => {
    // 9:00 PM CST 2026-03-07 = 03:00 UTC 2026-03-08
    // (this is the "Zach Bryan Concert" cross-midnight test case from spec —
    //  in VendCast schema, event_date=2026-03-07, setup_time=21:00; should
    //  produce 03:00 UTC on 2026-03-08, not drift the date.)
    const got = wallclockInZoneToUtcMs("2026-03-07", "21:00", "America/Chicago");
    expect(got).toBe(Date.UTC(2026, 2, 8, 3, 0, 0));
  });
});

describe("localDateInZone", () => {
  // These tests use vi.setSystemTime to pin "now" at a specific UTC
  // instant, then assert what the date string looks like in each zone.
  // Pattern: pick a UTC instant near a date boundary so the zone
  // comparison is meaningful (UTC midnight = late-evening US-east).

  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns operator-local YYYY-MM-DD (CDT summer)", () => {
    // 2026-05-11 18:00 UTC = 1:00 PM CDT same day.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 11, 18, 0, 0)));
    expect(localDateInZone("America/Chicago")).toBe("2026-05-11");
    expect(localDateInZone("America/New_York")).toBe("2026-05-11");
    expect(localDateInZone("UTC")).toBe("2026-05-11");
  });

  it("crosses a date boundary correctly (UTC vs Eastern late-night)", () => {
    // 2026-05-12 02:00 UTC = 10:00 PM EDT on 2026-05-11.
    // UTC's today is the 12th; Eastern's today is still the 11th.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 12, 2, 0, 0)));
    expect(localDateInZone("UTC")).toBe("2026-05-12");
    expect(localDateInZone("America/New_York")).toBe("2026-05-11");
    expect(localDateInZone("America/Los_Angeles")).toBe("2026-05-11");
  });

  it("offsetDays steps backward / forward within the zone", () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 11, 18, 0, 0)));
    expect(localDateInZone("America/Chicago", -1)).toBe("2026-05-10");
    expect(localDateInZone("America/Chicago", -3)).toBe("2026-05-08");
    expect(localDateInZone("America/Chicago", 1)).toBe("2026-05-12");
  });

  it("survives DST spring-forward (offsetDays of -1 stays on the prior day)", () => {
    // 2026-03-09 12:00 UTC = 7:00 AM CDT on 2026-03-09 (DST just started).
    // Going back one day should land on 2026-03-08, even though that day
    // was only 23 hours long in Central.
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 9, 12, 0, 0)));
    expect(localDateInZone("America/Chicago")).toBe("2026-03-09");
    expect(localDateInZone("America/Chicago", -1)).toBe("2026-03-08");
  });

  it("survives DST fall-back (offsetDays of -1 stays on the prior day)", () => {
    // 2026-11-02 12:00 UTC = 6:00 AM CST on 2026-11-02 (DST just ended,
    // back to CST). Going back one day should land on 2026-11-01.
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 2, 12, 0, 0)));
    expect(localDateInZone("America/Chicago")).toBe("2026-11-02");
    expect(localDateInZone("America/Chicago", -1)).toBe("2026-11-01");
  });

  it("falls back to UTC when zone is unrecognized", () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 11, 18, 0, 0)));
    expect(localDateInZone("Mars/Olympus_Mons")).toBe("2026-05-11");
  });

  it("Toledo (Eastern) and STL (Central) agree mid-day, disagree at UTC midnight", () => {
    // Mid-day UTC: all US zones on the same date.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 11, 18, 0, 0)));
    expect(localDateInZone("America/Detroit")).toBe("2026-05-11");
    expect(localDateInZone("America/Chicago")).toBe("2026-05-11");

    // UTC midnight = 7pm EST / 6pm CST the day before. Both still on
    // the prior date.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 12, 0, 0, 0)));
    expect(localDateInZone("UTC")).toBe("2026-05-12");
    expect(localDateInZone("America/Detroit")).toBe("2026-05-11");
    expect(localDateInZone("America/Chicago")).toBe("2026-05-11");
  });
});
