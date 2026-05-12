import { describe, it, expect } from "vitest";
import { detectMultiDayClusters, formatClusterDateRange } from "./event-clusters";
import type { Event } from "@/lib/database.types";

function mkEvent(partial: Partial<Event> & { id: string; event_name: string; event_date: string }): Event {
  return {
    user_id: "u1",
    start_time: null,
    end_time: null,
    setup_time: null,
    location: null,
    city: null,
    state: null,
    city_area: null,
    latitude: null,
    longitude: null,
    booked: true,
    is_private: false,
    net_sales: null,
    invoice_revenue: 0,
    event_type: null,
    event_tier: null,
    event_weather: null,
    anomaly_flag: "normal",
    event_mode: "food_truck",
    expected_attendance: null,
    other_trucks: null,
    fee_type: "none",
    fee_rate: 0,
    sales_minimum: 0,
    net_after_fees: null,
    forecast_sales: null,
    forecast_low: null,
    forecast_high: null,
    forecast_confidence: null,
    food_cost: null,
    labor_cost: null,
    other_costs: null,
    notes: null,
    pos_source: "manual",
    cancellation_reason: null,
    parking_loadin_notes: null,
    menu_type: "regular",
    special_menu_details: null,
    in_service_notes: [],
    content_capture_notes: null,
    after_event_summary: null,
    auto_ended_at: null,
    is_sample: false,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("detectMultiDayClusters", () => {
  it("returns empty map for no events", () => {
    const m = detectMultiDayClusters([]);
    expect(m.size).toBe(0);
  });

  it("single-event 'cluster' gets totalDays=1", () => {
    const events = [
      mkEvent({ id: "e1", event_name: "Lunchtime Live", event_date: "2026-05-13" }),
    ];
    const m = detectMultiDayClusters(events);
    const info = m.get("e1")!;
    expect(info.totalDays).toBe(1);
    expect(info.dayIndex).toBe(0);
    expect(info.allEventIds).toEqual(["e1"]);
  });

  it("groups consecutive dates of same event_name into one cluster", () => {
    const events = [
      mkEvent({ id: "d1", event_name: "Best of Missouri Festival", event_date: "2026-09-06" }),
      mkEvent({ id: "d2", event_name: "Best of Missouri Festival", event_date: "2026-09-07" }),
      mkEvent({ id: "d3", event_name: "Best of Missouri Festival", event_date: "2026-09-08" }),
    ];
    const m = detectMultiDayClusters(events);
    expect(m.get("d1")!.totalDays).toBe(3);
    expect(m.get("d1")!.dayIndex).toBe(0);
    expect(m.get("d2")!.dayIndex).toBe(1);
    expect(m.get("d3")!.dayIndex).toBe(2);
    expect(m.get("d1")!.startDate).toBe("2026-09-06");
    expect(m.get("d1")!.endDate).toBe("2026-09-08");
    // All three share the same cluster id (= first event id)
    expect(m.get("d1")!.clusterId).toBe(m.get("d2")!.clusterId);
    expect(m.get("d1")!.clusterId).toBe(m.get("d3")!.clusterId);
  });

  it("gap > 5 days starts a new cluster of the same event_name", () => {
    const events = [
      mkEvent({ id: "may1", event_name: "Punk Rock Flea Market", event_date: "2026-05-24" }),
      mkEvent({ id: "may2", event_name: "Punk Rock Flea Market", event_date: "2026-05-25" }),
      // Gap of ~7 days → separate cluster
      mkEvent({ id: "jun1", event_name: "Punk Rock Flea Market", event_date: "2026-06-01" }),
    ];
    const m = detectMultiDayClusters(events);
    expect(m.get("may1")!.totalDays).toBe(2);
    expect(m.get("may2")!.totalDays).toBe(2);
    expect(m.get("jun1")!.totalDays).toBe(1);
    expect(m.get("may1")!.clusterId).not.toBe(m.get("jun1")!.clusterId);
  });

  it("different event_names never cluster, even on same date", () => {
    const events = [
      mkEvent({ id: "a", event_name: "Lunchtime Live", event_date: "2026-05-13" }),
      mkEvent({ id: "b", event_name: "Twilight Tuesday", event_date: "2026-05-13" }),
      mkEvent({ id: "c", event_name: "Lunchtime Live", event_date: "2026-05-14" }),
    ];
    const m = detectMultiDayClusters(events);
    expect(m.get("a")!.totalDays).toBe(2);
    expect(m.get("c")!.totalDays).toBe(2);
    expect(m.get("b")!.totalDays).toBe(1);
  });

  it("case-insensitive name matching", () => {
    const events = [
      mkEvent({ id: "a", event_name: "9 Mile Garden", event_date: "2026-05-15" }),
      mkEvent({ id: "b", event_name: "9 mile garden", event_date: "2026-05-16" }),
    ];
    const m = detectMultiDayClusters(events);
    expect(m.get("a")!.totalDays).toBe(2);
  });

  it("5-day gap is the boundary (inclusive)", () => {
    const events = [
      mkEvent({ id: "a", event_name: "Test", event_date: "2026-05-01" }),
      // 5 days later → SAME cluster (gap === 5 is within bounds)
      mkEvent({ id: "b", event_name: "Test", event_date: "2026-05-06" }),
      // 6 days from b → NEW cluster
      mkEvent({ id: "c", event_name: "Test", event_date: "2026-05-12" }),
    ];
    const m = detectMultiDayClusters(events);
    expect(m.get("a")!.clusterId).toBe(m.get("b")!.clusterId);
    expect(m.get("b")!.clusterId).not.toBe(m.get("c")!.clusterId);
  });
});

describe("formatClusterDateRange", () => {
  it("same-month range", () => {
    expect(formatClusterDateRange("2026-05-03", "2026-05-05")).toBe("May 3–5");
    expect(formatClusterDateRange("2026-09-06", "2026-09-08")).toBe("Sep 6–8");
  });
  it("cross-month range", () => {
    expect(formatClusterDateRange("2026-05-30", "2026-06-01")).toBe("May 30 – Jun 1");
  });
  it("single-day 'range' (degenerate but valid)", () => {
    expect(formatClusterDateRange("2026-05-15", "2026-05-15")).toBe("May 15–15");
  });
});
