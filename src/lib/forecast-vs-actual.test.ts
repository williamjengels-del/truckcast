import { describe, it, expect } from "vitest";
import {
  getMostRecentForecastResult,
  getThisMonthAccuracy,
} from "./forecast-vs-actual";
import type { Event } from "./database.types";

function makeEvent(overrides: Record<string, unknown> = {}): Event {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    user_id: "user-1",
    event_name: "Test Event",
    event_date: "2026-04-15",
    start_time: null,
    end_time: null,
    setup_time: null,
    location: null,
    city: null,
    city_area: null,
    latitude: null,
    longitude: null,
    booked: true,
    is_private: false,
    net_sales: 1000,
    event_type: null,
    event_tier: null,
    event_weather: null,
    anomaly_flag: "normal",
    expected_attendance: null,
    other_trucks: null,
    fee_type: "flat_fee",
    fee_rate: 0,
    sales_minimum: 0,
    net_after_fees: null,
    forecast_sales: 1000,
    forecast_low: 850,
    forecast_high: 1150,
    forecast_confidence: "MEDIUM",
    cancellation_reason: null,
    notes: null,
    food_cost: null,
    labor_cost: null,
    other_costs: null,
    profit: null,
    invoice_revenue: 0,
    invoice_paid: false,
    event_mode: "food_truck",
    pos_source: "manual",
    parking_loadin_notes: null,
    menu_type: "regular",
    special_menu_details: null,
    in_service_notes: [],
    content_capture_notes: null,
    auto_ended_at: null,
    caused_by_event_id: null,
    source_inquiry_id: null,
    created_at: "2026-04-15T12:00:00Z",
    updated_at: "2026-04-15T12:00:00Z",
    ...overrides,
  } as unknown as Event;
}

describe("getMostRecentForecastResult", () => {
  it("returns null when there are no events", () => {
    expect(getMostRecentForecastResult([], "2026-05-07")).toBeNull();
  });

  it("returns null when no event has both forecast + actual", () => {
    const events = [
      makeEvent({ event_date: "2026-04-15", net_sales: null }),
      makeEvent({ event_date: "2026-04-20", forecast_sales: null }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")).toBeNull();
  });

  it("ignores future events", () => {
    const events = [
      makeEvent({ event_date: "2026-06-01", net_sales: 1500 }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")).toBeNull();
  });

  it("ignores disrupted events", () => {
    const events = [
      makeEvent({ event_date: "2026-04-15", anomaly_flag: "disrupted" }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")).toBeNull();
  });

  it("ignores boosted events (added 2026-05-07)", () => {
    const events = [
      makeEvent({ event_date: "2026-04-15", anomaly_flag: "boosted" }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")).toBeNull();
  });

  it("picks the most recent past event by date", () => {
    const events = [
      makeEvent({ event_date: "2026-03-01", event_name: "March" }),
      makeEvent({ event_date: "2026-04-15", event_name: "April" }),
      makeEvent({ event_date: "2026-02-10", event_name: "February" }),
    ];
    const result = getMostRecentForecastResult(events, "2026-05-07");
    expect(result?.eventName).toBe("April");
  });

  it("classifies actual within explicit forecast bounds as within_range", () => {
    const events = [
      makeEvent({
        net_sales: 1000,
        forecast_sales: 1000,
        forecast_low: 850,
        forecast_high: 1150,
      }),
    ];
    const result = getMostRecentForecastResult(events, "2026-05-07");
    expect(result?.outcome).toBe("within_range");
    expect(result?.hasExplicitBounds).toBe(true);
  });

  it("classifies actual below explicit low as below_range", () => {
    const events = [
      makeEvent({
        net_sales: 700,
        forecast_sales: 1000,
        forecast_low: 850,
        forecast_high: 1150,
      }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")?.outcome).toBe(
      "below_range"
    );
  });

  it("classifies actual above explicit high as above_range", () => {
    const events = [
      makeEvent({
        net_sales: 1300,
        forecast_sales: 1000,
        forecast_low: 850,
        forecast_high: 1150,
      }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")?.outcome).toBe(
      "above_range"
    );
  });

  it("falls back to ±20% when explicit bounds are missing", () => {
    const events = [
      makeEvent({
        net_sales: 1000,
        forecast_sales: 1000,
        forecast_low: null,
        forecast_high: null,
      }),
    ];
    const result = getMostRecentForecastResult(events, "2026-05-07");
    expect(result?.hasExplicitBounds).toBe(false);
    expect(result?.forecastLow).toBe(800);
    expect(result?.forecastHigh).toBe(1200);
    expect(result?.outcome).toBe("within_range");
  });

  it("prefers v2 (Bayesian) range over v1 when both are stored", () => {
    // v1 says wide range $400-$1600 → would classify $1200 within.
    // v2 says tighter $900-$1100 → should classify $1200 above.
    // The v2 range wins per the upgraded reader (PR 4).
    const events = [
      makeEvent({
        net_sales: 1200,
        forecast_sales: 1000,
        forecast_low: 400,
        forecast_high: 1600,
        forecast_bayesian_point: 1000,
        forecast_bayesian_low_80: 900,
        forecast_bayesian_high_80: 1100,
      }),
    ];
    const result = getMostRecentForecastResult(events, "2026-05-07");
    expect(result?.forecast).toBe(1000);
    expect(result?.forecastLow).toBe(900);
    expect(result?.forecastHigh).toBe(1100);
    expect(result?.outcome).toBe("above_range");
  });

  it("uses v2 point estimate when v1 forecast is missing", () => {
    // Edge case: v1 cleared (insufficient_data flagged it),
    // v2 didn't flag and has a point. Currently isEligible
    // requires v1 forecast_sales > 0 so this case actually
    // returns null — the v2-only forecast is excluded from
    // the recent-event surface. Documented here so a future
    // change to eligibility doesn't accidentally regress.
    const events = [
      makeEvent({
        net_sales: 1000,
        forecast_sales: null,
        forecast_low: null,
        forecast_high: null,
        forecast_bayesian_point: 1000,
        forecast_bayesian_low_80: 900,
        forecast_bayesian_high_80: 1100,
      }),
    ];
    expect(getMostRecentForecastResult(events, "2026-05-07")).toBeNull();
  });
});

describe("getThisMonthAccuracy", () => {
  it("returns null when no events this month", () => {
    const events = [makeEvent({ event_date: "2026-03-15" })];
    expect(getThisMonthAccuracy(events, "2026-05-07")).toBeNull();
  });

  // 2026-05-07: small-sample suppression. Below 5 eligible events
  // this month, the rolling stat is hidden — "1 of 3" reads as
  // statistical noise on the dashboard, not a meaningful signal.
  it("returns null below the small-sample threshold (< 5 events)", () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      makeEvent({
        event_date: `2026-05-0${i + 1}`,
        net_sales: 1000,
        forecast_low: 850,
        forecast_high: 1150,
      })
    );
    expect(getThisMonthAccuracy(events, "2026-05-07")).toBeNull();
  });

  it("counts past events this month with both forecast + actual at the small-sample threshold", () => {
    // 5 in-month eligible events — at the threshold, rolling stat
    // surfaces. 3 within range, 2 below.
    const events = [
      makeEvent({ event_date: "2026-05-01", net_sales: 1000, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-02", net_sales: 1050, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-03", net_sales: 900, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-04", net_sales: 600, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-05", net_sales: 500, forecast_low: 850, forecast_high: 1150 }),
      // In month, future — excluded
      makeEvent({ event_date: "2026-05-30" }),
      // Different month — excluded
      makeEvent({ event_date: "2026-04-25" }),
      // No actual sales — excluded
      makeEvent({ event_date: "2026-05-06", net_sales: null }),
    ];
    const result = getThisMonthAccuracy(events, "2026-05-07");
    expect(result).toEqual({ total: 5, inRange: 3 });
  });

  it("excludes boosted events from the rolling stat (added 2026-05-07)", () => {
    // 5 events, but one is boosted. Only 4 eligible -> below
    // threshold -> rolling stat suppressed.
    const events = [
      makeEvent({ event_date: "2026-05-01", net_sales: 1000, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-02", net_sales: 1050, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-03", net_sales: 900, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-04", net_sales: 600, forecast_low: 850, forecast_high: 1150 }),
      makeEvent({ event_date: "2026-05-05", net_sales: 5000, forecast_low: 850, forecast_high: 1150, anomaly_flag: "boosted" }),
    ];
    expect(getThisMonthAccuracy(events, "2026-05-07")).toBeNull();
  });

  it("uses ±20% fallback for events without explicit bounds (when sample meets threshold)", () => {
    // 5 in-month, no explicit bounds -> falls back to ±20%.
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        event_date: `2026-05-0${i + 1}`,
        net_sales: 1100,
        forecast_sales: 1000,
        forecast_low: null,
        forecast_high: null,
      })
    );
    const result = getThisMonthAccuracy(events, "2026-05-07");
    expect(result).toEqual({ total: 5, inRange: 5 });
  });
});
