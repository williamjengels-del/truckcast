/**
 * Tests for weather classification logic.
 * Covers boundary conditions and every classification branch.
 */

import { describe, it, expect } from "vitest";
import { classifyWeather, normalizeCityForGeocoding, cityGeocodeCandidates } from "./weather";

describe("classifyWeather", () => {
  // Priority 1: Snow
  it("classifies snow when temp ≤ 32 and precip > 0.1", () => {
    expect(classifyWeather({ maxTempF: 28, minTempF: 15, precipitationIn: 0.5, prevDayPrecipIn: 0 })).toBe("Snow");
  });

  it("does NOT classify snow when temp ≤ 32 but precip ≤ 0.1 (dry cold)", () => {
    expect(classifyWeather({ maxTempF: 30, minTempF: 20, precipitationIn: 0.05, prevDayPrecipIn: 0 })).not.toBe("Snow");
  });

  it("does NOT classify snow when precip > 0.1 but temp > 32 (warm rain)", () => {
    expect(classifyWeather({ maxTempF: 45, minTempF: 35, precipitationIn: 0.3, prevDayPrecipIn: 0 })).not.toBe("Snow");
  });

  // Priority 2: Storms
  it("classifies Storms when precip ≥ 1.0", () => {
    expect(classifyWeather({ maxTempF: 70, minTempF: 55, precipitationIn: 1.5, prevDayPrecipIn: 0 })).toBe("Storms");
  });

  it("classifies Storms at exactly 1.0 inch", () => {
    expect(classifyWeather({ maxTempF: 70, minTempF: 55, precipitationIn: 1.0, prevDayPrecipIn: 0 })).toBe("Storms");
  });

  // Priority 3: Rain During Event
  it("classifies Rain During Event at 0.25 in", () => {
    expect(classifyWeather({ maxTempF: 65, minTempF: 50, precipitationIn: 0.25, prevDayPrecipIn: 0 })).toBe("Rain During Event");
  });

  it("classifies Rain During Event for 0.99 in (just under Storms)", () => {
    expect(classifyWeather({ maxTempF: 65, minTempF: 50, precipitationIn: 0.99, prevDayPrecipIn: 0 })).toBe("Rain During Event");
  });

  // Priority 4: Hot
  it("classifies Hot when max ≥ 90 and dry", () => {
    expect(classifyWeather({ maxTempF: 95, minTempF: 72, precipitationIn: 0, prevDayPrecipIn: 0 })).toBe("Hot");
  });

  it("classifies Hot at exactly 90°F", () => {
    expect(classifyWeather({ maxTempF: 90, minTempF: 70, precipitationIn: 0, prevDayPrecipIn: 0 })).toBe("Hot");
  });

  // Priority 5: Cold
  it("classifies Cold when max ≤ 40 and dry", () => {
    expect(classifyWeather({ maxTempF: 38, minTempF: 25, precipitationIn: 0.02, prevDayPrecipIn: 0 })).toBe("Cold");
  });

  it("classifies Cold at exactly 40°F", () => {
    expect(classifyWeather({ maxTempF: 40, minTempF: 28, precipitationIn: 0, prevDayPrecipIn: 0 })).toBe("Cold");
  });

  // Priority 6 & 7: Rain Before Event
  it("classifies Rain Before Event when precip is light (0.05–0.24)", () => {
    expect(classifyWeather({ maxTempF: 65, minTempF: 52, precipitationIn: 0.1, prevDayPrecipIn: 0 })).toBe("Rain Before Event");
  });

  it("classifies Rain Before Event when prev day had heavy rain and today is dry", () => {
    expect(classifyWeather({ maxTempF: 68, minTempF: 54, precipitationIn: 0.02, prevDayPrecipIn: 0.5 })).toBe("Rain Before Event");
  });

  it("does NOT classify Rain Before Event when prev day rain was light and today is dry", () => {
    const result = classifyWeather({ maxTempF: 68, minTempF: 54, precipitationIn: 0.02, prevDayPrecipIn: 0.1 });
    // Should fall to Clear since prevDayPrecipIn < 0.25 and precipitationIn < 0.05
    expect(result).toBe("Clear");
  });

  // Priority 8: Clear (default)
  it("classifies Clear for perfect weather", () => {
    expect(classifyWeather({ maxTempF: 75, minTempF: 58, precipitationIn: 0, prevDayPrecipIn: 0 })).toBe("Clear");
  });

  it("classifies Clear for warm slightly cloudy day with no precip", () => {
    expect(classifyWeather({ maxTempF: 82, minTempF: 65, precipitationIn: 0.04, prevDayPrecipIn: 0 })).toBe("Clear");
  });

  // Boundary: Snow takes priority over Rain checks
  it("Snow takes priority over Rain During Event (cold + high precip)", () => {
    expect(classifyWeather({ maxTempF: 30, minTempF: 20, precipitationIn: 1.5, prevDayPrecipIn: 0 })).toBe("Snow");
  });
});

describe("normalizeCityForGeocoding", () => {
  it("strips trailing state abbreviation", () => {
    expect(normalizeCityForGeocoding("Saint Louis, MO")).toBe("Saint Louis");
    expect(normalizeCityForGeocoding("Belleville, IL")).toBe("Belleville");
  });

  it("does NOT swap Saint↔St (the historical bug — see candidates instead)", () => {
    // Saint Ann is in Open-Meteo as "Saint Ann"; converting to "St Ann"
    // returned no US results (audit 2026-05-08, 33 events flagged
    // GEOCODE_FAILED). Keep input form; let candidates handle the swap retry.
    expect(normalizeCityForGeocoding("Saint Ann")).toBe("Saint Ann");
    expect(normalizeCityForGeocoding("Saint Peters")).toBe("Saint Peters");
  });

  it("trims whitespace", () => {
    expect(normalizeCityForGeocoding("  Saint Louis  ")).toBe("Saint Louis");
  });

  it("returns empty for empty input", () => {
    expect(normalizeCityForGeocoding("")).toBe("");
  });
});

describe("cityGeocodeCandidates", () => {
  it("includes both Saint and St forms for a Saint-prefix city", () => {
    const candidates = cityGeocodeCandidates("Saint Louis");
    expect(candidates).toContain("Saint Louis");
    expect(candidates).toContain("St Louis");
  });

  it("includes both St and Saint forms for an abbreviated input", () => {
    const candidates = cityGeocodeCandidates("St Charles");
    expect(candidates).toContain("St Charles");
    expect(candidates).toContain("Saint Charles");
  });

  it("Scott AFB aliases to Belleville (military base, not in GeoNames)", () => {
    expect(cityGeocodeCandidates("Scott Afb")[0]).toBe("Belleville");
  });

  it("Scott AFB alias is case-insensitive", () => {
    expect(cityGeocodeCandidates("scott afb")[0]).toBe("Belleville");
    expect(cityGeocodeCandidates("SCOTT AFB")[0]).toBe("Belleville");
  });

  it("Central West End aliases to Saint Louis (neighborhood, not city)", () => {
    expect(cityGeocodeCandidates("Central West End")[0]).toBe("Saint Louis");
    expect(cityGeocodeCandidates("Central West End Saint Louis")[0]).toBe("Saint Louis");
  });

  it("alias result also gets Saint↔St swap variants for Open-Meteo lookup", () => {
    const cwe = cityGeocodeCandidates("Central West End");
    expect(cwe).toContain("Saint Louis");
    expect(cwe).toContain("St Louis");
  });

  it("strips state suffix before generating candidates", () => {
    const candidates = cityGeocodeCandidates("Saint Louis, MO");
    expect(candidates).toContain("Saint Louis");
    expect(candidates).not.toContain("Saint Louis, MO");
  });

  it("dedupes candidates that collapse to the same string", () => {
    const candidates = cityGeocodeCandidates("Belleville");
    expect(candidates).toEqual(["Belleville"]);
  });

  it("handles empty input", () => {
    expect(cityGeocodeCandidates("")).toEqual([]);
    expect(cityGeocodeCandidates("   ")).toEqual([]);
  });

  it("preserves operator's typing for plain cities", () => {
    expect(cityGeocodeCandidates("Manchester")[0]).toBe("Manchester");
    expect(cityGeocodeCandidates("Chicago")[0]).toBe("Chicago");
  });
});
