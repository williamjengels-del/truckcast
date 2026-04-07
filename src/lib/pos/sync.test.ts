import { describe, it, expect } from "vitest";
import { aggregateByDate } from "./sync";

describe("aggregateByDate", () => {
  it("sums orders on the same date", () => {
    const orders = [
      { createdAt: "2026-04-03T10:00:00Z", netSales: 100 },
      { createdAt: "2026-04-03T14:00:00Z", netSales: 200 },
    ];
    const result = aggregateByDate(orders);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-04-03", netSales: 300 });
  });

  it("produces separate entries for different dates", () => {
    const orders = [
      { createdAt: "2026-04-03T10:00:00Z", netSales: 100 },
      { createdAt: "2026-04-04T10:00:00Z", netSales: 200 },
    ];
    const result = aggregateByDate(orders);
    expect(result).toHaveLength(2);
    const dates = result.map((r) => r.date);
    expect(dates).toContain("2026-04-03");
    expect(dates).toContain("2026-04-04");
  });

  it("rounds to 2 decimal places", () => {
    const orders = [
      { createdAt: "2026-04-03T10:00:00Z", netSales: 100.333 },
      { createdAt: "2026-04-03T11:00:00Z", netSales: 100.333 },
    ];
    const result = aggregateByDate(orders);
    expect(result[0].netSales).toBe(200.67);
  });

  it("returns empty array for no orders", () => {
    expect(aggregateByDate([])).toEqual([]);
  });
});
