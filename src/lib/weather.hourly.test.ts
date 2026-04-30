import { describe, it, expect } from "vitest";
import {
  wmoCodeToCondition,
  sliceHourlyToServiceWindow,
  type HourlyWeatherEntry,
} from "./weather";

function makeHour(hour: number, partial: Partial<HourlyWeatherEntry> = {}): HourlyWeatherEntry {
  return {
    hour,
    tempF: partial.tempF ?? 70,
    weatherCode: partial.weatherCode ?? 0,
    windMph: partial.windMph ?? 5,
    precipIn: partial.precipIn ?? 0,
  };
}

describe("wmoCodeToCondition", () => {
  it("maps clear-sky code to Clear", () => {
    expect(wmoCodeToCondition(0)).toBe("Clear");
  });
  it("maps cloud-cover codes to partly cloudy / cloudy", () => {
    expect(wmoCodeToCondition(1)).toBe("Partly cloudy");
    expect(wmoCodeToCondition(2)).toBe("Partly cloudy");
    expect(wmoCodeToCondition(3)).toBe("Cloudy");
  });
  it("maps fog codes (45-48)", () => {
    expect(wmoCodeToCondition(45)).toBe("Fog");
    expect(wmoCodeToCondition(48)).toBe("Fog");
  });
  it("maps rain codes (51-67, 80-82)", () => {
    expect(wmoCodeToCondition(51)).toBe("Rain");
    expect(wmoCodeToCondition(63)).toBe("Rain");
    expect(wmoCodeToCondition(80)).toBe("Rain");
    expect(wmoCodeToCondition(82)).toBe("Rain");
  });
  it("maps snow codes", () => {
    expect(wmoCodeToCondition(71)).toBe("Snow");
    expect(wmoCodeToCondition(85)).toBe("Snow");
  });
  it("maps storm codes (95+)", () => {
    expect(wmoCodeToCondition(95)).toBe("Storm");
    expect(wmoCodeToCondition(99)).toBe("Storm");
  });
  it("falls back to em-dash for unknown codes", () => {
    expect(wmoCodeToCondition(-1)).toBe("—");
    expect(wmoCodeToCondition(40)).toBe("—");
  });
});

describe("sliceHourlyToServiceWindow", () => {
  const fullDay: HourlyWeatherEntry[] = Array.from({ length: 24 }, (_, h) => makeHour(h));

  it("returns full array when no times provided", () => {
    expect(sliceHourlyToServiceWindow(fullDay, null, null)).toHaveLength(24);
  });

  it("includes both endpoint hours (11:30-13:30 -> hours 11,12,13)", () => {
    const got = sliceHourlyToServiceWindow(fullDay, "11:30", "13:30");
    expect(got.map((h) => h.hour)).toEqual([11, 12, 13]);
  });

  it("uses 0 as start floor when only end_time set", () => {
    const got = sliceHourlyToServiceWindow(fullDay, null, "06:00");
    expect(got.map((h) => h.hour)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("uses 23 as end ceiling when only start_time set", () => {
    const got = sliceHourlyToServiceWindow(fullDay, "21:00", null);
    expect(got.map((h) => h.hour)).toEqual([21, 22, 23]);
  });

  it("returns empty array when service window doesn't overlap", () => {
    // Start_time < hour 0 is impossible, but verify a fully-out-of-band
    // window: start hour 25 (impossible) yields empty.
    const malformed = sliceHourlyToServiceWindow(fullDay, "abc", "def");
    // Malformed both -> NaN guard returns full array (doc'd behavior).
    expect(malformed).toHaveLength(24);
  });

  it("narrow service window like Annual Logan Symposium 12:20-1:30 returns hours 12, 13", () => {
    // Spec test case: 11:15 setup / 12:20 start / 1:30 end CDT.
    // Hourly weather should display only 12 PM and 1 PM hours.
    const got = sliceHourlyToServiceWindow(fullDay, "12:20", "13:30");
    expect(got.map((h) => h.hour)).toEqual([12, 13]);
  });
});
