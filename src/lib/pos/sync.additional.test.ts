/**
 * Additional tests for POS sync utilities.
 * Covers edge cases in aggregateByDate not in the main suite.
 */

import { describe, it, expect } from "vitest";
import { aggregateByDate } from "./sync";

describe("aggregateByDate — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(aggregateByDate([])).toEqual([]);
  });

  it("single order produces a single day aggregate", () => {
    const result = aggregateByDate([{ createdAt: "2025-04-07T12:00:00Z", netSales: 100 }]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2025-04-07");
    expect(result[0].netSales).toBe(100);
  });

  it("orders from the same day (different times) are summed", () => {
    const orders = [
      { createdAt: "2025-04-07T10:00:00Z", netSales: 200 },
      { createdAt: "2025-04-07T14:30:00Z", netSales: 350 },
      { createdAt: "2025-04-07T18:00:00Z", netSales: 150 },
    ];
    const result = aggregateByDate(orders);
    expect(result).toHaveLength(1);
    expect(result[0].netSales).toBe(700);
  });

  it("orders across three days produce three separate aggregates", () => {
    const orders = [
      { createdAt: "2025-04-05T12:00:00Z", netSales: 100 },
      { createdAt: "2025-04-06T12:00:00Z", netSales: 200 },
      { createdAt: "2025-04-07T12:00:00Z", netSales: 300 },
    ];
    const result = aggregateByDate(orders);
    expect(result).toHaveLength(3);
    const dates = result.map((r) => r.date).sort();
    expect(dates).toEqual(["2025-04-05", "2025-04-06", "2025-04-07"]);
  });

  it("rounds fractional cents to 2 decimal places", () => {
    const orders = [
      { createdAt: "2025-04-07T10:00:00Z", netSales: 10.333 },
      { createdAt: "2025-04-07T11:00:00Z", netSales: 10.333 },
    ];
    const result = aggregateByDate(orders);
    expect(result[0].netSales).toBe(20.67);
  });

  it("handles large number of orders on the same day", () => {
    const orders = Array.from({ length: 200 }, (_, i) => ({
      createdAt: `2025-04-07T${String(Math.floor(i / 10)).padStart(2, "0")}:${String((i % 10) * 5).padStart(2, "0")}:00Z`,
      netSales: 10,
    }));
    const result = aggregateByDate(orders);
    expect(result).toHaveLength(1);
    expect(result[0].netSales).toBe(2000);
  });

  it("handles orders spread across a year with mixed same-day entries", () => {
    const orders = [
      { createdAt: "2025-01-15T10:00:00Z", netSales: 500 },
      { createdAt: "2025-01-15T15:00:00Z", netSales: 300 },
      { createdAt: "2025-06-15T10:00:00Z", netSales: 800 },
      { createdAt: "2025-12-31T23:59:59Z", netSales: 1200 },
    ];
    const result = aggregateByDate(orders);
    const byDate = Object.fromEntries(result.map((r) => [r.date, r.netSales]));
    expect(byDate["2025-01-15"]).toBe(800);
    expect(byDate["2025-06-15"]).toBe(800);
    expect(byDate["2025-12-31"]).toBe(1200);
  });

  it("handles zero-value orders", () => {
    const orders = [
      { createdAt: "2025-04-07T10:00:00Z", netSales: 0 },
      { createdAt: "2025-04-07T11:00:00Z", netSales: 100 },
    ];
    const result = aggregateByDate(orders);
    expect(result[0].netSales).toBe(100);
  });
});
