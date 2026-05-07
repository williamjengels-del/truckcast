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
import {
  canonicalizeCity,
  canonicalizeCityAndState,
  extractStateFromCity,
  normalizeStateCode,
} from "./city-normalize";

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

describe("canonicalizeCity — period-attached, no space", () => {
  // The bug a real operator hit: typed "St.louis" with no space between
  // the period and the next word. The original lookahead-for-whitespace
  // pattern left this alone. New behavior expands it like the spaced
  // form. Same logic for the rest of the abbreviation dictionary.
  it('"St.Louis" → "Saint Louis"', () => {
    expect(canonicalizeCity("St.Louis")).toBe("Saint Louis");
  });
  it('lowercase "st.louis" → "Saint Louis"', () => {
    expect(canonicalizeCity("st.louis")).toBe("Saint Louis");
  });
  it('all caps "ST.LOUIS" → "Saint Louis"', () => {
    expect(canonicalizeCity("ST.LOUIS")).toBe("Saint Louis");
  });
  it('"Mt.Pleasant" → "Mount Pleasant"', () => {
    expect(canonicalizeCity("Mt.Pleasant")).toBe("Mount Pleasant");
  });
  it('"Ft.Collins" → "Fort Collins"', () => {
    expect(canonicalizeCity("Ft.Collins")).toBe("Fort Collins");
  });
  it('"Pt.Reyes" → "Point Reyes"', () => {
    expect(canonicalizeCity("Pt.Reyes")).toBe("Point Reyes");
  });
  it('"St.Marys" → "Saint Marys" (real city name pattern)', () => {
    expect(canonicalizeCity("St.Marys")).toBe("Saint Marys");
  });
  it('"N.Bend" → "North Bend"', () => {
    expect(canonicalizeCity("N.Bend")).toBe("North Bend");
  });
  it('"W.Palm Beach" → "West Palm Beach"', () => {
    expect(canonicalizeCity("W.Palm Beach")).toBe("West Palm Beach");
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
  it("does not expand a bare directional letter at end of input", () => {
    // Single trailing letter is too ambiguous to assume directional
    // intent — leave it alone. Title-case still applies.
    expect(canonicalizeCity("Some Place N")).toBe("Some Place N");
    expect(canonicalizeCity("Some Place N.")).toBe("Some Place N.");
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

describe("canonicalizeCity — apostrophe capitalization (regression for O'fallon bug)", () => {
  // Pre-2026-05-07 the title-case helper split only on whitespace +
  // dash, so "O'Fallon" stayed as one segment and got mapped to
  // "O'fallon" (the F got lower-cased). 53 of Wok-O Taco's 689 events
  // had this corrupted form. Apostrophe split fixes it.
  it('"O\'Fallon" stays "O\'Fallon"', () => {
    expect(canonicalizeCity("O'Fallon")).toBe("O'Fallon");
  });
  it('"o\'fallon" → "O\'Fallon"', () => {
    expect(canonicalizeCity("o'fallon")).toBe("O'Fallon");
  });
  it('"O\'FALLON" → "O\'Fallon"', () => {
    expect(canonicalizeCity("O'FALLON")).toBe("O'Fallon");
  });
  it('"D\'Iberville" stays correctly capitalized', () => {
    expect(canonicalizeCity("d'iberville")).toBe("D'Iberville");
  });
  it("apostrophe stays at the right position", () => {
    expect(canonicalizeCity("st. o'fallon")).toBe("Saint O'Fallon");
  });
});

describe("normalizeStateCode", () => {
  it("2-letter code (any case) → uppercase code", () => {
    expect(normalizeStateCode("MO")).toBe("MO");
    expect(normalizeStateCode("mo")).toBe("MO");
    expect(normalizeStateCode("Mo")).toBe("MO");
    expect(normalizeStateCode("mO")).toBe("MO");
    expect(normalizeStateCode("IL")).toBe("IL");
    expect(normalizeStateCode("il")).toBe("IL");
    expect(normalizeStateCode("Il")).toBe("IL");
  });
  it("full state name (any case) → 2-letter code", () => {
    expect(normalizeStateCode("Missouri")).toBe("MO");
    expect(normalizeStateCode("missouri")).toBe("MO");
    expect(normalizeStateCode("MISSOURI")).toBe("MO");
    expect(normalizeStateCode("Illinois")).toBe("IL");
    expect(normalizeStateCode("illinois")).toBe("IL");
  });
  it("OTHER sentinel passes through", () => {
    expect(normalizeStateCode("OTHER")).toBe("OTHER");
    expect(normalizeStateCode("other")).toBe("OTHER");
  });
  it("returns null for unrecognized input", () => {
    expect(normalizeStateCode("XX")).toBeNull();
    expect(normalizeStateCode("Wakanda")).toBeNull();
    expect(normalizeStateCode("")).toBeNull();
    expect(normalizeStateCode(null)).toBeNull();
    expect(normalizeStateCode(undefined)).toBeNull();
  });
});

describe("extractStateFromCity", () => {
  it("strips trailing 2-letter code with comma", () => {
    expect(extractStateFromCity("Saint Louis, MO")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("strips trailing 2-letter code without comma", () => {
    expect(extractStateFromCity("Saint Louis Mo")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("strips trailing full state name", () => {
    expect(extractStateFromCity("Saint Louis Missouri")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("strips trailing zip after state code", () => {
    expect(extractStateFromCity("Saint Louis Mo 63101")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("strips trailing zip+4 after state code", () => {
    expect(extractStateFromCity("Saint Louis MO 63101-1234")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("Illinois case", () => {
    expect(extractStateFromCity("Belleville Il")).toEqual({
      city: "Belleville",
      state: "IL",
    });
    expect(extractStateFromCity("Belleville, IL")).toEqual({
      city: "Belleville",
      state: "IL",
    });
    expect(extractStateFromCity("Belleville Illinois")).toEqual({
      city: "Belleville",
      state: "IL",
    });
  });
  it("returns null state when none is found", () => {
    expect(extractStateFromCity("Saint Louis")).toEqual({
      city: "Saint Louis",
      state: null,
    });
    expect(extractStateFromCity("Chicago")).toEqual({
      city: "Chicago",
      state: null,
    });
  });
  it("does not falsely strip a city ending in a 2-letter sequence that isn't a state", () => {
    // "Reno NV" works (real state); "Mojo XX" should not strip XX.
    expect(extractStateFromCity("Mojo Xx")).toEqual({
      city: "Mojo Xx",
      state: null,
    });
  });
  it("handles two-word state names like 'New York'", () => {
    expect(extractStateFromCity("Buffalo New York")).toEqual({
      city: "Buffalo",
      state: "NY",
    });
  });
  it("empty input returns empty city + null state", () => {
    expect(extractStateFromCity("")).toEqual({ city: "", state: null });
  });
});

describe("canonicalizeCityAndState — combined helper", () => {
  it("normalizes city AND extracts state from suffix", () => {
    expect(canonicalizeCityAndState("st. louis mo")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("operator-supplied state takes precedence over city suffix", () => {
    // Operator typed "Saint Louis IL" by mistake but selected MO in
    // the dropdown → MO wins.
    expect(canonicalizeCityAndState("Saint Louis IL", "MO")).toEqual({
      city: "Saint Louis",
      state: "MO",
    });
  });
  it("operator state with no suffix in city", () => {
    expect(canonicalizeCityAndState("Chicago", "IL")).toEqual({
      city: "Chicago",
      state: "IL",
    });
  });
  it("apostrophe + state suffix together", () => {
    expect(canonicalizeCityAndState("o'fallon mo")).toEqual({
      city: "O'Fallon",
      state: "MO",
    });
  });
  it("normalizes operator-supplied state in any case form", () => {
    expect(canonicalizeCityAndState("Chicago", "illinois")).toEqual({
      city: "Chicago",
      state: "IL",
    });
    expect(canonicalizeCityAndState("Chicago", "Il")).toEqual({
      city: "Chicago",
      state: "IL",
    });
  });
  it("empty city, valid state", () => {
    expect(canonicalizeCityAndState("", "MO")).toEqual({
      city: "",
      state: "MO",
    });
  });
  it("empty city, no state", () => {
    expect(canonicalizeCityAndState(null, null)).toEqual({
      city: "",
      state: null,
    });
  });
});
