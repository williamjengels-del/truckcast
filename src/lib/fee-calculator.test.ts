/**
 * Tests for the fee calculator.
 * Covers all 5 fee types, edge cases, and the net-after-fees helper.
 */

import { describe, it, expect } from "vitest";
import { calcEventFee, calcNetAfterFees } from "./fee-calculator";

// ─── calcEventFee ────────────────────────────────────────────────────────────

describe("calcEventFee — flat_fee", () => {
  it("returns the flat fee amount regardless of gross sales", () => {
    expect(calcEventFee(1000, "flat_fee", 150)).toBe(150);
  });

  it("returns flat fee even when gross is very low (e.g. rainy day $50)", () => {
    expect(calcEventFee(50, "flat_fee", 150)).toBe(150);
  });

  it("returns flat fee when gross equals fee exactly", () => {
    expect(calcEventFee(150, "flat_fee", 150)).toBe(150);
  });

  it("returns 0 when flat fee rate is 0", () => {
    expect(calcEventFee(1000, "flat_fee", 0)).toBe(0);
  });

  it("clamps negative fee_rate to 0 (data integrity guard)", () => {
    expect(calcEventFee(1000, "flat_fee", -50)).toBe(0);
  });
});

describe("calcEventFee — percentage", () => {
  it("returns 10% of gross correctly", () => {
    expect(calcEventFee(1000, "percentage", 10)).toBeCloseTo(100);
  });

  it("returns 15% of gross correctly", () => {
    expect(calcEventFee(800, "percentage", 15)).toBeCloseTo(120);
  });

  it("handles fractional percentages (e.g. 7.5%)", () => {
    expect(calcEventFee(1000, "percentage", 7.5)).toBeCloseTo(75);
  });

  it("returns 0 when fee_rate is 0%", () => {
    expect(calcEventFee(1000, "percentage", 0)).toBe(0);
  });

  it("100% fee returns full gross amount", () => {
    expect(calcEventFee(500, "percentage", 100)).toBeCloseTo(500);
  });
});

describe("calcEventFee — commission_with_minimum", () => {
  it("uses percentage when it exceeds the minimum", () => {
    // 10% of $2000 = $200, minimum = $100 → fee = $200
    expect(calcEventFee(2000, "commission_with_minimum", 10, 100)).toBeCloseTo(200);
  });

  it("uses minimum when percentage falls below it", () => {
    // 10% of $500 = $50, minimum = $100 → fee = $100
    expect(calcEventFee(500, "commission_with_minimum", 10, 100)).toBe(100);
  });

  it("returns minimum when percentage equals minimum exactly", () => {
    // 10% of $1000 = $100, minimum = $100 → fee = $100
    expect(calcEventFee(1000, "commission_with_minimum", 10, 100)).toBeCloseTo(100);
  });

  it("works with zero minimum (behaves like percentage)", () => {
    expect(calcEventFee(800, "commission_with_minimum", 12, 0)).toBeCloseTo(96);
  });

  it("works with zero gross — returns minimum", () => {
    expect(calcEventFee(0, "commission_with_minimum", 10, 75)).toBe(75);
  });
});

describe("calcEventFee — pre_settled", () => {
  it("always returns 0 (payment already settled separately)", () => {
    expect(calcEventFee(1200, "pre_settled", 500)).toBe(0);
  });

  it("returns 0 even when fee_rate is large", () => {
    expect(calcEventFee(5000, "pre_settled", 9999)).toBe(0);
  });
});

describe("calcEventFee — none / unknown types", () => {
  it("returns 0 for fee type 'none'", () => {
    expect(calcEventFee(1000, "none", 0)).toBe(0);
  });

  it("returns 0 for unknown fee type (safety default)", () => {
    expect(calcEventFee(1000, "mystery_type", 100)).toBe(0);
  });

  it("returns 0 for empty string fee type", () => {
    expect(calcEventFee(1000, "", 0)).toBe(0);
  });
});

describe("calcEventFee — edge cases", () => {
  it("returns 0 when gross is negative (guard against bad data)", () => {
    expect(calcEventFee(-100, "flat_fee", 50)).toBe(0);
  });

  it("handles large sales amounts without overflow", () => {
    const fee = calcEventFee(100000, "percentage", 15);
    expect(fee).toBeCloseTo(15000);
    expect(Number.isFinite(fee)).toBe(true);
  });
});

// ─── calcNetAfterFees ────────────────────────────────────────────────────────

describe("calcNetAfterFees", () => {
  it("subtracts flat fee from gross", () => {
    expect(calcNetAfterFees(1000, "flat_fee", 150)).toBeCloseTo(850);
  });

  it("subtracts percentage fee from gross", () => {
    expect(calcNetAfterFees(1000, "percentage", 10)).toBeCloseTo(900);
  });

  it("subtracts commission fee from gross", () => {
    // 10% of $2000 = $200 > $100 minimum → net = $1800
    expect(calcNetAfterFees(2000, "commission_with_minimum", 10, 100)).toBeCloseTo(1800);
  });

  it("net never goes below 0 even if fee exceeds gross", () => {
    // flat_fee of $500 on $200 gross → net = 0 (not -$300)
    expect(calcNetAfterFees(200, "flat_fee", 500)).toBe(0);
  });

  it("returns full gross when fee type is none", () => {
    expect(calcNetAfterFees(750, "none", 0)).toBe(750);
  });

  it("returns full gross for pre_settled (fee handled externally)", () => {
    expect(calcNetAfterFees(1200, "pre_settled", 900)).toBe(1200);
  });

  it("handles zero gross with zero fee", () => {
    expect(calcNetAfterFees(0, "none", 0)).toBe(0);
  });
});
