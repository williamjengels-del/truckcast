import { describe, it, expect } from "vitest";
import { wallclockInZoneToUtcMs } from "./wallclock-tz";

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
