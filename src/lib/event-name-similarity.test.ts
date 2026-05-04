import { describe, it, expect } from "vitest";
import {
  levenshtein,
  levRatio,
  jaccard,
  pairKey,
  findSuggestionPairs,
  type EventNameInput,
} from "./event-name-similarity";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("foo", "foo")).toBe(0);
  });
  it("counts single-character edit", () => {
    expect(levenshtein("foo", "fop")).toBe(1);
    expect(levenshtein("foo", "fooo")).toBe(1);
    expect(levenshtein("foos", "foo")).toBe(1);
  });
  it("handles empty inputs", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("levRatio", () => {
  it("returns 1.0 for identical strings", () => {
    expect(levRatio("foo", "foo")).toBe(1);
  });
  it("trailing-s case scores high", () => {
    // 'fenton food truck nights' vs 'fenton food truck night' — one
    // edit on a 24-char max → ratio ~0.96.
    const r = levRatio("fenton food truck nights", "fenton food truck night");
    expect(r).toBeGreaterThan(0.95);
  });
  it("returns 1 for two empty strings", () => {
    expect(levRatio("", "")).toBe(1);
  });
});

describe("jaccard", () => {
  it("token overlap detection", () => {
    // Same words different order → jaccard = 1.0
    expect(jaccard("foo bar baz", "baz bar foo")).toBe(1);
  });
  it("partial overlap", () => {
    // 'food truck friday' and 'food truck fridays' — tokens differ on
    // 'friday' vs 'fridays', so {food, truck} intersect / {food,
    // truck, friday, fridays} union = 2/4 = 0.5.
    const j = jaccard("food truck friday", "food truck fridays");
    expect(j).toBeCloseTo(0.5, 2);
  });
  it("ignores tokens of length ≤ 2", () => {
    // 'a' and 'in' are dropped, so the comparison is just 'foo' vs 'foo'.
    expect(jaccard("a foo in", "foo")).toBe(1);
  });
});

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
  it("is the lex-sorted concatenation", () => {
    expect(pairKey("zoo", "alpha")).toBe("alpha||zoo");
  });
});

describe("findSuggestionPairs", () => {
  function input(normalized: string, ops = 2): EventNameInput {
    return { normalized, display: normalized, operator_count: ops };
  }

  it("flags trailing-s near-miss", () => {
    const pairs = findSuggestionPairs(
      [input("fenton food truck nights"), input("fenton food truck night")],
      new Set()
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].lev_ratio).toBeGreaterThan(0.9);
  });

  it("excludes pairs whose key is on the exclude list", () => {
    const a = input("fenton food truck nights");
    const b = input("fenton food truck night");
    const pairs = findSuggestionPairs(
      [a, b],
      new Set([pairKey(a.normalized, b.normalized)])
    );
    expect(pairs).toHaveLength(0);
  });

  it("does not flag clearly different events", () => {
    // 'sports tailgate' vs 'corporate lunch' — no shared words, low
    // lev ratio. Should not surface.
    const pairs = findSuggestionPairs(
      [input("sports tailgate"), input("corporate lunch")],
      new Set()
    );
    expect(pairs).toHaveLength(0);
  });

  it("ranks higher-similarity pairs first", () => {
    const inputs = [
      input("food truck friday"),
      input("food truck fridays"), // ratio ~ 0.94, jaccard ~0.66
      input("food truck friday fenton"), // longer, lower lev ratio
    ];
    const pairs = findSuggestionPairs(inputs, new Set());
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    // Top should be the trailing-s match
    expect(pairs[0].a.normalized).toMatch(/^food truck friday/);
    expect(pairs[0].b.normalized).toMatch(/^food truck friday/);
  });
});
