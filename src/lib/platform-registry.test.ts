import { describe, it, expect } from "vitest";
import {
  __computeAggregate,
  __computeAggregateExcludingViewer,
} from "./platform-registry";

// Test rows omit Phase 1 fields by default — helper fills them as null.
function row(overrides: {
  user_id: string;
  net_sales: number;
  event_type?: string | null;
  city?: string | null;
  other_trucks?: number | null;
  expected_attendance?: number | null;
  fee_type?: string | null;
  fee_rate?: number | null;
  event_date?: string | null;
  event_weather?: string | null;
}) {
  return {
    user_id: overrides.user_id,
    net_sales: overrides.net_sales,
    event_type: overrides.event_type ?? null,
    city: overrides.city ?? null,
    other_trucks: overrides.other_trucks ?? null,
    expected_attendance: overrides.expected_attendance ?? null,
    fee_type: overrides.fee_type ?? null,
    fee_rate: overrides.fee_rate ?? null,
    event_date: overrides.event_date ?? null,
    event_weather: overrides.event_weather ?? null,
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

  it("computes modal_fee_type + median_fee_rate at the 3+ operator floor", () => {
    // 3 operators all charge a flat fee — modal is 'flat_fee', median rate
    // is the median of the three rates ($100, $150, $200).
    const rows = [
      row({ user_id: "u1", net_sales: 1000, fee_type: "flat_fee", fee_rate: 100 }),
      row({ user_id: "u2", net_sales: 1200, fee_type: "flat_fee", fee_rate: 150 }),
      row({ user_id: "u3", net_sales: 1500, fee_type: "flat_fee", fee_rate: 200 }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.modal_fee_type).toBe("flat_fee");
    expect(agg?.median_fee_rate).toBe(150);
  });

  it("does NOT publish fee aggregates below the 3+ operator floor", () => {
    // 2 operators meets the sales floor but not the fee floor.
    const rows = [
      row({ user_id: "u1", net_sales: 1000, fee_type: "flat_fee", fee_rate: 100 }),
      row({ user_id: "u2", net_sales: 1200, fee_type: "flat_fee", fee_rate: 150 }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.median_sales).toBe(1100); // sales aggregate fine at 2+
    expect(agg?.modal_fee_type).toBeNull();
    expect(agg?.median_fee_rate).toBeNull();
  });

  it("medians fee_rate ONLY across rows matching the modal fee_type", () => {
    // 3 operators flat_fee, 2 percentage. Modal = flat_fee. Median rate
    // is over the flat_fee rows only — would be nonsense to average a
    // flat $200 against a 12% percentage.
    const rows = [
      row({ user_id: "u1", net_sales: 1000, fee_type: "flat_fee", fee_rate: 100 }),
      row({ user_id: "u2", net_sales: 1200, fee_type: "flat_fee", fee_rate: 200 }),
      row({ user_id: "u3", net_sales: 1500, fee_type: "flat_fee", fee_rate: 300 }),
      row({ user_id: "u4", net_sales: 800, fee_type: "percentage", fee_rate: 12 }),
      row({ user_id: "u5", net_sales: 900, fee_type: "percentage", fee_rate: 15 }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.modal_fee_type).toBe("flat_fee");
    expect(agg?.median_fee_rate).toBe(200); // median of 100, 200, 300
  });

  it("returns null fee_rate when modal is 'none'", () => {
    // 3 operators have no fee — modal_fee_type=none, but no rate to median.
    const rows = [
      row({ user_id: "u1", net_sales: 1000, fee_type: "none" }),
      row({ user_id: "u2", net_sales: 1200, fee_type: "none" }),
      row({ user_id: "u3", net_sales: 1500, fee_type: "none" }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.modal_fee_type).toBe("none");
    expect(agg?.median_fee_rate).toBeNull();
  });

  it("computes modal_weather_by_month at the 3+ per-cell floor", () => {
    // 3 operators all booked April events with Clear weather → publish.
    // Same 3 in May with Rain Before Event → publish. Cells with <3
    // distinct operators are absent from the output entirely.
    const rows = [
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-15", event_weather: "Clear" }),
      row({ user_id: "u2", net_sales: 1200, event_date: "2026-04-22", event_weather: "Clear" }),
      row({ user_id: "u3", net_sales: 1500, event_date: "2026-04-29", event_weather: "Clear" }),
      row({ user_id: "u1", net_sales: 800, event_date: "2026-05-06", event_weather: "Rain Before Event" }),
      row({ user_id: "u2", net_sales: 900, event_date: "2026-05-13", event_weather: "Rain Before Event" }),
      row({ user_id: "u3", net_sales: 1100, event_date: "2026-05-20", event_weather: "Rain Before Event" }),
      // Single-operator November row should NOT publish
      row({ user_id: "u1", net_sales: 700, event_date: "2026-11-04", event_weather: "Cold" }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.modal_weather_by_month["4"]).toEqual({ weather: "Clear", count: 3 });
    expect(agg?.modal_weather_by_month["5"]).toEqual({ weather: "Rain Before Event", count: 3 });
    expect(agg?.modal_weather_by_month["11"]).toBeUndefined(); // below floor
  });

  it("computes dow_lift at the 3+ per-cell distinct-operator floor", () => {
    // 3 operators each book a Saturday + a Tuesday at this event.
    // Saturdays earn $1500 each, Tuesdays $500 each. Event median across
    // all 6 bookings = $1000. Saturday lift = +50%, Tuesday lift = -50%.
    const rows = [
      row({ user_id: "u1", net_sales: 1500, event_date: "2026-04-04" }), // Sat
      row({ user_id: "u2", net_sales: 1500, event_date: "2026-04-11" }), // Sat
      row({ user_id: "u3", net_sales: 1500, event_date: "2026-04-18" }), // Sat
      row({ user_id: "u1", net_sales: 500, event_date: "2026-04-07" }),  // Tue
      row({ user_id: "u2", net_sales: 500, event_date: "2026-04-14" }),  // Tue
      row({ user_id: "u3", net_sales: 500, event_date: "2026-04-21" }),  // Tue
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.dow_lift["6"]).toEqual({ lift_pct: 50, count: 3 });  // Sat
    expect(agg?.dow_lift["2"]).toEqual({ lift_pct: -50, count: 3 }); // Tue
  });

  it("does NOT publish dow cells with <3 distinct operators (one operator's many Saturdays)", () => {
    // u1 owns 5 Saturdays at this event, u2 + u3 each have one. 3 ops
    // total satisfies the EVENT-level floor (so the row publishes), but
    // the Sunday cell only has u3 (1 distinct op). Saturday cell has
    // 3 distinct ops — should publish.
    const rows = [
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-04" }),  // Sat
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-11" }),  // Sat
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-18" }),  // Sat
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-25" }),  // Sat
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-05-02" }),  // Sat
      row({ user_id: "u2", net_sales: 1000, event_date: "2026-05-09" }),  // Sat
      row({ user_id: "u3", net_sales: 1000, event_date: "2026-05-16" }),  // Sat
      row({ user_id: "u3", net_sales: 800, event_date: "2026-05-17" }),   // Sun
    ];
    const agg = __computeAggregate(rows);
    expect(agg?.dow_lift["6"]).toBeDefined();         // 3 distinct ops on Sat
    expect(agg?.dow_lift["6"].count).toBe(3);
    expect(agg?.dow_lift["0"]).toBeUndefined();       // 1 op on Sun, below floor
  });

  it("counts DISTINCT operators per (month × weather) cell, not bookings", () => {
    // u1 booked April-Clear 3 times, u2 once. Cell has 2 distinct ops, NOT 4.
    // Should NOT publish (below 3+ floor).
    const rows = [
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-01", event_weather: "Clear" }),
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-08", event_weather: "Clear" }),
      row({ user_id: "u1", net_sales: 1000, event_date: "2026-04-15", event_weather: "Clear" }),
      row({ user_id: "u2", net_sales: 1200, event_date: "2026-04-22", event_weather: "Clear" }),
      // Need a second-operator row so the event aggregate publishes at all
      row({ user_id: "u2", net_sales: 1200, event_date: "2026-05-01", event_weather: "Overcast" }),
    ];
    const agg = __computeAggregate(rows);
    expect(agg).not.toBeNull();
    expect(agg?.modal_weather_by_month["4"]).toBeUndefined(); // 2 distinct ops, below floor
  });
});

describe("computeAggregateExcludingViewer (seed-operator-phase fix)", () => {
  // The 2-operator scenario the operator clarified 2026-05-11: with
  // Wok-O (u1) + Nick (u2) sharing data, both should see a viewer-
  // excluded aggregate computed from the other's rows. Privacy floor
  // is checked on the FULL bucket (2 ops → passes); the returned
  // aggregate's medians come from the excluded subset.
  it("fires at 2 operators total — viewer sees the other operator's stats", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 1000, event_type: "Festival", city: "STL" }),
      row({ user_id: "u1", net_sales: 1500, event_type: "Festival", city: "STL" }),
      row({ user_id: "u2", net_sales: 2000, event_type: "Festival", city: "STL" }),
      row({ user_id: "u2", net_sales: 2500, event_type: "Festival", city: "STL" }),
    ];
    // u1 viewing — should see medians computed from u2's rows only.
    const agg = __computeAggregateExcludingViewer(rows, "u1");
    expect(agg).not.toBeNull();
    if (!agg) return;
    // operator_count reports FULL bucket (privacy-relevant number that
    // the engine reads for its firing threshold).
    expect(agg.operator_count).toBe(2);
    // total_instances + medians reflect the excluded subset (u2's rows).
    expect(agg.total_instances).toBe(2);
    expect(agg.median_sales).toBe(2250); // (2000 + 2500) / 2
    expect(agg.min_sales).toBe(2000);
    expect(agg.max_sales).toBe(2500);
  });

  it("u2 viewer sees u1's stats — symmetric to the above", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 1000, event_type: "Festival" }),
      row({ user_id: "u1", net_sales: 1500, event_type: "Festival" }),
      row({ user_id: "u2", net_sales: 2000, event_type: "Festival" }),
      row({ user_id: "u2", net_sales: 2500, event_type: "Festival" }),
    ];
    const agg = __computeAggregateExcludingViewer(rows, "u2");
    expect(agg).not.toBeNull();
    if (!agg) return;
    expect(agg.operator_count).toBe(2);
    expect(agg.total_instances).toBe(2);
    expect(agg.median_sales).toBe(1250); // (1000 + 1500) / 2
  });

  it("returns null when the full bucket has only 1 operator (privacy floor)", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 1000 }),
      row({ user_id: "u1", net_sales: 1500 }),
    ];
    // No matter who's viewing, this bucket can't publish — the
    // privacy contract requires ≥2 distinct operators contributed.
    expect(__computeAggregateExcludingViewer(rows, "u1")).toBeNull();
    expect(__computeAggregateExcludingViewer(rows, "u2")).toBeNull();
  });

  it("returns null when the viewer was the sole contributor in a multi-op bucket", () => {
    // Degenerate but possible: u1 has rows, u2 has none. Viewer = u2,
    // who sees no rows. Privacy floor on full bucket fails (1 distinct
    // op) — so this is just confirming the null path.
    const rows = [
      row({ user_id: "u1", net_sales: 1000 }),
      row({ user_id: "u1", net_sales: 1500 }),
    ];
    expect(__computeAggregateExcludingViewer(rows, "u2")).toBeNull();
  });

  it("3 operators total — viewer sees 2-op aggregate (regression-toward-self avoided)", () => {
    const rows = [
      row({ user_id: "u1", net_sales: 1000 }), // viewer
      row({ user_id: "u2", net_sales: 2000 }),
      row({ user_id: "u3", net_sales: 3000 }),
    ];
    const agg = __computeAggregateExcludingViewer(rows, "u1");
    expect(agg).not.toBeNull();
    if (!agg) return;
    // operator_count reports the FULL bucket — 3. Excluded medians from u2 + u3.
    expect(agg.operator_count).toBe(3);
    expect(agg.total_instances).toBe(2);
    expect(agg.median_sales).toBe(2500); // (2000 + 3000) / 2 — NOT influenced by u1's 1000
  });

  it("does not re-apply the ≥2 floor on the excluded subset", () => {
    // The bug fixed by this function: the prior shape called
    // computeAggregate on the pre-excluded set, which re-applied the
    // ≥2 floor and structurally required ≥3 total operators. Here we
    // pin: 2 total ops, excluded subset has 1 op → still publishes.
    const rows = [
      row({ user_id: "u1", net_sales: 100 }), // viewer
      row({ user_id: "u2", net_sales: 200 }),
    ];
    const agg = __computeAggregateExcludingViewer(rows, "u1");
    expect(agg).not.toBeNull();
    expect(agg?.total_instances).toBe(1);
    expect(agg?.median_sales).toBe(200);
  });
});
