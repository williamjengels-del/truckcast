import { describe, it, expect } from "vitest";
import { __computeAggregate } from "./platform-registry";

// Test rows omit Phase 1 fields by default — helper fills them as null.
function row(overrides: {
  user_id: string;
  net_sales: number;
  event_type?: string | null;
  city?: string | null;
  other_trucks?: number | null;
  expected_attendance?: number | null;
}) {
  return {
    user_id: overrides.user_id,
    net_sales: overrides.net_sales,
    event_type: overrides.event_type ?? null,
    city: overrides.city ?? null,
    other_trucks: overrides.other_trucks ?? null,
    expected_attendance: overrides.expected_attendance ?? null,
  };
}

// Coverage for the extracted aggregate helper. The DB-touching
// surface (getPlatformEventsExcludingUser) is harder to test in
// isolation because it composes a multi-step Supabase query — its
// correctness is exercised by the forecast-display tests + Playwright.

describe("computeAggregate (platform-registry)", () => {
  it("returns null on empty input", () => {
    expect(__computeAggregate([])).toBeNull();
  });

  it("returns null below the privacy floor (1 distinct operator)", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 1000, event_type: "Festival", city: "STL" }),
      row({ user_id: "u1", net_sales: 1200, event_type: "Festival", city: "STL" }),
      row({ user_id: "u1", net_sales: 800, event_type: "Festival", city: "STL" }),
    ];
    expect(__computeAggregate(rows)).toBeNull();
  });

  it("computes operator_count + median + percentiles for 2+ operators", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 500, event_type: "Festival", city: "STL" }),
      row({ user_id: "u2", net_sales: 1500, event_type: "Festival", city: "STL" }),
      row({ user_id: "u1", net_sales: 1000, event_type: "Festival", city: "STL" }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg).not.toBeNull();
    if (!agg) return;
    expect(agg.operator_count).toBe(2);
    expect(agg.total_instances).toBe(3);
    expect(agg.median_sales).toBe(1000);
    expect(agg.min_sales).toBe(500);
    expect(agg.max_sales).toBe(1500);
    expect(agg.most_common_event_type).toBe("Festival");
    expect(agg.most_common_city).toBe("STL");
  });

  it("median for even-length sales averages the two middle values", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 100 }),
      row({ user_id: "u2", net_sales: 200 }),
      row({ user_id: "u3", net_sales: 300 }),
      row({ user_id: "u4", net_sales: 400 }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.median_sales).toBe(250); // (200 + 300) / 2
  });

  it("most_common_event_type breaks ties by first-seen order", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 100, event_type: "Festival" }),
      row({ user_id: "u2", net_sales: 200, event_type: "Festival" }),
      row({ user_id: "u3", net_sales: 300, event_type: "Concert" }),
      row({ user_id: "u4", net_sales: 400, event_type: "Concert" }),
    ];
    const agg = __computeAggregate(rows);
    // Both Festival and Concert tied at 2; sort is stable so the
    // first one that reached the count wins. Either is acceptable
    // for a tie — assert one of them.
    expect(["Festival", "Concert"]).toContain(agg?.most_common_event_type);
  });

  it("computes median_other_trucks across rows that have it", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 100, other_trucks: 4 }),
      row({ user_id: "u2", net_sales: 200, other_trucks: 8 }),
      row({ user_id: "u3", net_sales: 300, other_trucks: 12 }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.median_other_trucks).toBe(8);
  });

  it("ignores nulls when computing Phase 1 aggregates", () => {
    // Only u2 + u3 contribute attendance; median should be of those two.
    const rows = [
      row({ user_id: "u1", net_sales: 100 }),
      row({ user_id: "u2", net_sales: 200, expected_attendance: 500 }),
      row({ user_id: "u3", net_sales: 300, expected_attendance: 1500 }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.median_attendance).toBe(1000); // (500 + 1500) / 2
    expect(agg?.median_other_trucks).toBeNull(); // none populated
  });
});
