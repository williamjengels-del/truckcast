import { describe, it, expect } from "vitest";
import { calculateEventPerformance } from "./event-performance";
import type { Event } from "./database.types";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    user_id: "user-1",
    event_name: "Farmers Market",
    event_date: "2025-06-01",
    event_type: "farmers_market",
    city: "St. Louis",
    state: "MO",
    booked: true,
    net_sales: 1000,
    expected_attendance: 500,
    fee_type: "none",
    fee_flat: null,
    fee_percent: null,
    fee_notes: null,
    weather_type: "sunny",
    anomaly_flag: null,
    disrupted: false,
    disruption_reason: null,
    forecast_sales: null,
    pos_source: null,
    notes: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  } as Event;
}

describe("calculateEventPerformance", () => {
  it("calculates basic stats for a single event", () => {
    const events = [makeEvent({ net_sales: 1000 })];
    const result = calculateEventPerformance("Farmers Market", "user-1", events);
    expect(result.event_name).toBe("Farmers Market");
    expect(result.times_booked).toBe(1);
    expect(result.avg_sales).toBe(1000);
    expect(result.total_sales).toBe(1000);
  });

  it("excludes disrupted events from sales stats but counts them in times_booked", () => {
    const events = [
      makeEvent({ id: "e1", event_date: "2025-06-01", net_sales: 1000 }),
      makeEvent({ id: "e2", event_date: "2025-07-01", net_sales: 500, anomaly_flag: "disrupted" }),
    ];
    const result = calculateEventPerformance("Farmers Market", "user-1", events);
    expect(result.times_booked).toBe(2);
    expect(result.avg_sales).toBe(1000); // disrupted excluded from average
    expect(result.total_sales).toBe(1000);
  });

  it("computes correct min/max across multiple events", () => {
    const events = [
      makeEvent({ id: "e1", event_date: "2025-06-01", net_sales: 800 }),
      makeEvent({ id: "e2", event_date: "2025-07-01", net_sales: 1200 }),
      makeEvent({ id: "e3", event_date: "2025-08-01", net_sales: 1000 }),
    ];
    const result = calculateEventPerformance("Farmers Market", "user-1", events);
    expect(result.min_sales).toBe(800);
    expect(result.max_sales).toBe(1200);
    expect(result.avg_sales).toBe(1000);
  });

  it("only includes events matching the given event_name", () => {
    const events = [
      makeEvent({ id: "e1", event_name: "Farmers Market", net_sales: 1000 }),
      makeEvent({ id: "e2", event_name: "Food Truck Fest", net_sales: 5000 }),
    ];
    const result = calculateEventPerformance("Farmers Market", "user-1", events);
    expect(result.times_booked).toBe(1);
    expect(result.avg_sales).toBe(1000);
  });

  it("returns user_id on the result", () => {
    const events = [makeEvent()];
    const result = calculateEventPerformance("Farmers Market", "user-1", events);
    expect(result.user_id).toBe("user-1");
  });

  it("returns zero stats when no booked events with sales exist", () => {
    const events = [makeEvent({ net_sales: null })];
    const result = calculateEventPerformance("Farmers Market", "user-1", events);
    expect(result.avg_sales).toBe(0);
    expect(result.times_booked).toBe(0);
  });
});
