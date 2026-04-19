/**
 * Tests for canonicalizeCity.
 *
 * Covers the abbreviation dictionary and the casing-normalization
 * behavior. Because this function is applied at save time and the
 * stored value is what downstream aggregation compares against, a
 * regression here would silently fork data across reads. Worth a
 * thorough unit suite.
 */

import { describe, it, expect } from "vitest";
import { canonicalizeCity } from "./city-normalize";

describe("canonicalizeCity — Saint / Mount / Fort / Point", () => {
  it('"St. Louis" → "Saint Louis"', () => {
    expect(canonicalizeCity("St. Louis")).toBe("Saint Louis");
  });
  it('"St Louis" (no period) → "Saint Louis"', () => {
    expect(canonicalizeCity("St Louis")).toBe("Saint Louis");
  });
  it('lowercase "st. louis" → "Saint Louis"', () => {
    expect(canonicalizeCity("st. louis")).toBe("Saint Louis");
  });
  it('all caps "ST LOUIS" → "Saint Louis"', () => {
    expect(canonicalizeCity("ST LOUIS")).toBe("Saint Louis");
  });
  it('"Mt. Pleasant" → "Mount Pleasant"', () => {
    expect(canonicalizeCity("Mt. Pleasant")).toBe("Mount Pleasant");
  });
  it('"Ft. Collins" → "Fort Collins"', () => {
    expect(canonicalizeCity("Ft. Collins")).toBe("Fort Collins");
  });
  it('"Pt. Reyes" → "Point Reyes"', () => {
    expect(canonicalizeCity("Pt. Reyes")).toBe("Point Reyes");
  });
});

describe("canonicalizeCity — directional prefixes", () => {
  it('"N. Bend" → "North Bend"', () => {
    expect(canonicalizeCity("N. Bend")).toBe("North Bend");
  });
  it('"S Park" → "South Park"', () => {
    expect(canonicalizeCity("S Park")).toBe("South Park");
  });
  it('"E. Lansing" → "East Lansing"', () => {
    expect(canonicalizeCity("E. Lansing")).toBe("East Lansing");
  });
  it('"W. Palm Beach" → "West Palm Beach"', () => {
    expect(canonicalizeCity("W. Palm Beach")).toBe("West Palm Beach");
  });
  it("does not expand mid-word directional letters", () => {
    // "Newark" starts with "N" but isn't a directional prefix.
    expect(canonicalizeCity("Newark")).toBe("Newark");
    // "Salinas" starts with "S".
    expect(canonicalizeCity("Salinas")).toBe("Salinas");
  });
});

describe("canonicalizeCity — idempotency + casing", () => {
  it("is idempotent (canonical form unchanged)", () => {
    const once = canonicalizeCity("St. Louis");
    const twice = canonicalizeCity(once);
    expect(twice).toBe(once);
  });
  it("title-cases multi-word names", () => {
    expect(canonicalizeCity("chicago")).toBe("Chicago");
    expect(canonicalizeCity("NEW YORK")).toBe("New York");
    expect(canonicalizeCity("san francisco")).toBe("San Francisco");
  });
  it("title-cases hyphenated names", () => {
    expect(canonicalizeCity("winston-salem")).toBe("Winston-Salem");
  });
  it("collapses internal whitespace", () => {
    expect(canonicalizeCity("San   Francisco")).toBe("San Francisco");
  });
  it("trims leading/trailing whitespace", () => {
    expect(canonicalizeCity("  Chicago  ")).toBe("Chicago");
  });
});

describe("canonicalizeCity — edges", () => {
  it("empty string returns empty string", () => {
    expect(canonicalizeCity("")).toBe("");
  });
  it("whitespace-only returns empty string", () => {
    expect(canonicalizeCity("   ")).toBe("");
  });
  it("null returns empty string", () => {
    expect(canonicalizeCity(null)).toBe("");
  });
  it("undefined returns empty string", () => {
    expect(canonicalizeCity(undefined)).toBe("");
  });
  it("does not invent characters for nonsense input", () => {
    expect(canonicalizeCity("xyz")).toBe("Xyz");
  });
});
