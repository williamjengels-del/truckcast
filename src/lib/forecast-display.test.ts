import { describe, it, expect } from "vitest";
import {
  isFixedRevenueEvent,
  fixedRevenueAmount,
  forecastContextSentence,
} from "./forecast-display";
import type { Event } from "./database.types";
import type { ForecastResult } from "./forecast-engine";

// Minimal event-row factory. Only fills the fields the helpers under
// test actually read; other Event fields are defaulted.
function eventOf(overrides: Partial<Event>): Event {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    event_name: "Test",
    event_date: "2026-05-01",
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
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  } as Event;
}

describe("isFixedRevenueEvent", () => {
  it("treats catering events as fixed", () => {
    expect(isFixedRevenueEvent(eventOf({ event_mode: "catering" }))).toBe(true);
  });

  it("treats events with positive invoice_revenue as fixed", () => {
    expect(
      isFixedRevenueEvent(eventOf({ invoice_revenue: 1500 }))
    ).toBe(true);
  });

  it("treats pre_settled events as fixed (contracted payout)", () => {
    expect(
      isFixedRevenueEvent(
        eventOf({ fee_type: "pre_settled", fee_rate: 1500 })
      )
    ).toBe(true);
  });

  it("treats commission_with_minimum + positive minimum as fixed", () => {
    expect(
      isFixedRevenueEvent(
        eventOf({ fee_type: "commission_with_minimum", sales_minimum: 1000 })
      )
    ).toBe(true);
  });

  it("does NOT treat commission_with_minimum + zero minimum as fixed", () => {
    expect(
      isFixedRevenueEvent(
        eventOf({ fee_type: "commission_with_minimum", sales_minimum: 0 })
      )
    ).toBe(false);
  });

  it("does NOT treat plain percentage / flat_fee / none as fixed", () => {
    expect(isFixedRevenueEvent(eventOf({ fee_type: "none" }))).toBe(false);
    expect(isFixedRevenueEvent(eventOf({ fee_type: "flat_fee", fee_rate: 200 }))).toBe(false);
    expect(isFixedRevenueEvent(eventOf({ fee_type: "percentage", fee_rate: 10 }))).toBe(false);
  });
});

describe("fixedRevenueAmount", () => {
  it("returns the pre-settled contracted payout from fee_rate", () => {
    const event = eventOf({ fee_type: "pre_settled", fee_rate: 1750 });
    expect(fixedRevenueAmount(event)).toBe(1750);
  });

  it("returns the minimum for commission_with_minimum", () => {
    const event = eventOf({
      fee_type: "commission_with_minimum",
      sales_minimum: 1200,
      forecast_sales: 800, // forecast below the floor — irrelevant for the headline
    });
    expect(fixedRevenueAmount(event)).toBe(1200);
  });

  it("prefers invoice_revenue when set", () => {
    expect(
      fixedRevenueAmount(eventOf({ invoice_revenue: 2400 }))
    ).toBe(2400);
  });

  it("falls back through net_sales then forecast", () => {
    expect(
      fixedRevenueAmount(eventOf({ net_sales: 900 }))
    ).toBe(900);
    expect(
      fixedRevenueAmount(eventOf({ forecast_sales: 700 }))
    ).toBe(700);
  });

  it("returns 0 when nothing is set", () => {
    expect(fixedRevenueAmount(eventOf({}))).toBe(0);
  });
});

describe("forecastContextSentence (other-operators copy)", () => {
  // Helper to build a partial forecast result; fills only what the
  // sentence reads.
  function forecast(
    overrides: Partial<ForecastResult>
  ): ForecastResult {
    return {
      forecast: 1000,
      level: 1,
      confidence: "MEDIUM",
      confidenceScore: 0.5,
      dataPoints: 9,
      method: "test",
      explanation: "test",
      breakdown: {},
      calibrated: false,
      venueFamiliarityApplied: false,
      platformBlendApplied: false,
      ...overrides,
    } as ForecastResult;
  }

  const event = eventOf({ event_date: "2026-05-02", event_type: "Festival" });

  it("uses platformOperatorCount directly (engine returns others-only count)", () => {
    // After operator-notes Q2 fix (2026-04-28), engine self-filters
    // via getPlatformEventsExcludingUser — platformOperatorCount IS
    // the count of other operators. No display-side subtract.
    const result = forecastContextSentence(
      forecast({
        level: 1,
        platformBlendApplied: true,
        platformOperatorCount: 1, // 1 other operator
        dataPoints: 9,
      }),
      event
    );
    expect(result).toBe(
      "Based on your 9 prior bookings + 1 other operator's data"
    );
  });

  it("pluralizes when 2+ other operators on L1 + blend", () => {
    const result = forecastContextSentence(
      forecast({
        level: 1,
        platformBlendApplied: true,
        platformOperatorCount: 4, // 4 other operators
        dataPoints: 12,
      }),
      event
    );
    expect(result).toContain("4 other operators' data");
  });

  it("L0 cold-start uses ops directly (operator hasn't contributed)", () => {
    // At L0 the operator has no bookings for this event — their data
    // isn't in the platform aggregate, so ops IS the count of others.
    const result = forecastContextSentence(
      forecast({
        level: 0,
        platformBlendApplied: true,
        platformOperatorCount: 3,
        dataPoints: 0,
      }),
      event
    );
    expect(result).toContain("3 other operators' data");
  });
});
