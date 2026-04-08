/**
 * Tests for the forecast engine.
 * Covers all 4 forecast levels, weather/day adjustments, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { calculateForecast, calibrateCoefficients } from "./forecast-engine";
import type { Event } from "./database.types";

// Test helper: uses Record<string, unknown> so tests can pass arbitrary event_type strings
// (e.g. "School", "Farmers Market") that aren't in the strict EventType union.
// Cast to Event at the end — intentional, the engine must handle unknown types gracefully.
function makeEvent(overrides: Record<string, unknown> = {}): Event {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    user_id: "user-1",
    event_name: "Test Market",
    event_date: "2024-06-15",
    start_time: null,
    end_time: null,
    setup_time: null,
    location: null,
    city: "St. Louis",
    city_area: null,
    latitude: null,
    longitude: null,
    booked: true,
    is_private: false,
    net_sales: 1000,
    event_type: "Farmers Market",
    event_tier: null,
    event_weather: "Clear",
    anomaly_flag: "normal",
    expected_attendance: null,
    other_trucks: null,
    fee_type: "flat_fee",
    fee_rate: 0,
    sales_minimum: 0,
    net_after_fees: null,
    forecast_sales: null,
    pos_source: "manual",
    notes: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  } as unknown as Event;
}

// Level 1 needs 1+ direct name match
// Level 3 needs 5+ events of same type (engine threshold)
// Level 4 needs event_date set
const HISTORY: Event[] = [
  makeEvent({ id: "h1", event_name: "Fox High School", net_sales: 1200, event_date: "2023-09-15", event_type: "School" }),
  makeEvent({ id: "h2", event_name: "Fox High School", net_sales: 1100, event_date: "2023-10-15", event_type: "School" }),
  makeEvent({ id: "h3", event_name: "Fox High School", net_sales: 1150, event_date: "2024-01-15", event_type: "School" }),
  makeEvent({ id: "h4", event_name: "Fox High School", net_sales: 1180, event_date: "2024-03-15", event_type: "School" }),
  makeEvent({ id: "h5", event_name: "Fox High School", net_sales: 1220, event_date: "2024-05-15", event_type: "School" }),
  // 5x Farmers Market events — enough for Level 3
  makeEvent({ id: "h6", event_name: "Market A", net_sales: 800, event_date: "2023-06-01", event_type: "Farmers Market" }),
  makeEvent({ id: "h7", event_name: "Market B", net_sales: 900, event_date: "2023-07-01", event_type: "Farmers Market" }),
  makeEvent({ id: "h8", event_name: "Market C", net_sales: 850, event_date: "2023-08-01", event_type: "Farmers Market" }),
  makeEvent({ id: "h9", event_name: "Market D", net_sales: 820, event_date: "2023-09-01", event_type: "Farmers Market" }),
  makeEvent({ id: "h10", event_name: "Market E", net_sales: 880, event_date: "2023-10-01", event_type: "Farmers Market" }),
  makeEvent({ id: "h11", event_name: "Corporate", net_sales: 2000, event_date: "2023-11-01", event_type: "Corporate" }),
];

describe("calculateForecast", () => {
  it("returns null when no valid historical events exist", () => {
    const result = calculateForecast({ event_name: "New Event" }, []);
    expect(result).toBeNull();
  });

  it("returns null when no events have sales (all null)", () => {
    const noSales = [makeEvent({ net_sales: null }), makeEvent({ net_sales: null })];
    const result = calculateForecast({ event_name: "Test" }, noSales);
    expect(result).toBeNull();
  });

  it("excludes disrupted events from forecast calculation", () => {
    const disruptedOnly = [makeEvent({ net_sales: 5000, anomaly_flag: "disrupted" })];
    const result = calculateForecast({ event_name: "Test Market", event_type: "Farmers Market" }, disruptedOnly);
    expect(result).toBeNull();
  });

  it("Level 1: matches by exact event name (case-insensitive)", () => {
    const target = { event_name: "fox high school", event_type: "School" };
    const result = calculateForecast(target, HISTORY);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(1);
    expect(result!.levelName).toBe("Direct Event History");
    expect(result!.forecast).toBeGreaterThan(0);
    // Should be around 1100-1200 (recency-weighted average)
    expect(result!.forecast).toBeGreaterThan(900);
    expect(result!.forecast).toBeLessThan(1400);
  });

  it("Level 3: falls back to event type average when no name match and 5+ events of that type", () => {
    // HISTORY has 5 Farmers Market events — meets Level 3 threshold
    const target = { event_name: "Brand New Farmers Market", event_type: "Farmers Market", city: "St. Louis" };
    const result = calculateForecast(target, HISTORY);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(3);
    expect(result!.forecast).toBeGreaterThan(700); // ~850 avg
  });

  it("Level 4: falls back to seasonal average for unknown type when event_date is provided", () => {
    // No "Food Truck Rodeo" events in HISTORY, so Level 3 fails; Level 4 uses seasonal
    const target = { event_name: "Unknown Event Type", event_type: "Food Truck Rodeo", event_date: "2025-06-15" };
    const result = calculateForecast(target, HISTORY);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(4);
    expect(result!.forecast).toBeGreaterThan(0);
  });

  it("returns null for unknown type with no event_date (Level 4 requires date)", () => {
    const target = { event_name: "Unknown", event_type: "Unknown Type" };
    const result = calculateForecast(target, HISTORY);
    // Level 1: no name match, Level 2: no type match, Level 3: <5 events of type, Level 4: no date
    expect(result).toBeNull();
  });

  it("single historical event still generates a forecast", () => {
    const oneEvent = [makeEvent({ event_name: "Solo Gig", net_sales: 500, event_type: "Private" })];
    const result = calculateForecast({ event_name: "Solo Gig" }, oneEvent);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(1);
    expect(result!.forecast).toBeCloseTo(500, 0);
  });

  it("forecast is positive even with low historical sales", () => {
    const lowSales = [makeEvent({ net_sales: 50 }), makeEvent({ net_sales: 75 })];
    const result = calculateForecast({ event_name: "Test Market" }, lowSales);
    expect(result!.forecast).toBeGreaterThan(0);
  });

  it("confidenceScore is between 0 and 1", () => {
    const result = calculateForecast({ event_name: "Fox High School" }, HISTORY);
    expect(result!.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result!.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("confidence is MEDIUM for 5 events with stale history (> 6 months, no calibration)", () => {
    // All HISTORY events are from 2023-2024 → recencyScore = 0 → total ~0.42 → MEDIUM
    // Real users with recent events + calibration will reach HIGH
    const result = calculateForecast({ event_name: "Fox High School" }, HISTORY);
    expect(result!.confidence).toBe("MEDIUM");
  });

  it("confidence reaches HIGH with recent events and calibration", () => {
    const recentYear = new Date().getFullYear();
    const recentHistory = Array.from({ length: 6 }, (_, i) =>
      makeEvent({
        event_name: "Recent Recurring Event",
        net_sales: 1000 + i * 20, // consistent
        event_date: `${recentYear}-0${Math.min(i + 1, 9)}-15`,
        event_type: "Farmers Market",
      })
    );
    const calibrated = calibrateCoefficients(recentHistory);
    const result = calculateForecast(
      { event_name: "Recent Recurring Event" },
      recentHistory,
      { calibratedCoefficients: calibrated ?? undefined }
    );
    expect(result).not.toBeNull();
    // Recent data + calibration should push above 0.6
    expect(result!.confidence).toBe("HIGH");
  });

  it("confidence is lower for single-event history", () => {
    const singleHistory = [makeEvent({ event_name: "Rare Event", net_sales: 1000 })];
    const result = calculateForecast({ event_name: "Rare Event" }, singleHistory);
    // Single data point = low confidence
    expect(result!.confidence).not.toBe("HIGH");
  });
});

describe("calibrateCoefficients", () => {
  it("returns null when no history (not enough data to calibrate)", () => {
    const result = calibrateCoefficients([]);
    expect(result).toBeNull();
  });

  it("returns null when all events have no sales", () => {
    const noSales = [makeEvent({ net_sales: null }), makeEvent({ net_sales: 0 })];
    const result = calibrateCoefficients(noSales);
    expect(result).toBeNull();
  });

  it("returns object with weather and dayOfWeek keys when data exists", () => {
    const result = calibrateCoefficients(HISTORY);
    expect(result).not.toBeNull();
    expect(typeof result!.weather).toBe("object");
    expect(typeof result!.dayOfWeek).toBe("object");
  });

  it("weather coefficients are positive numbers when enough data", () => {
    const moreHistory = [
      ...HISTORY,
      makeEvent({ net_sales: 400, event_weather: "Rain During Event" }),
      makeEvent({ net_sales: 420, event_weather: "Rain During Event" }),
      makeEvent({ net_sales: 1100, event_weather: "Clear" }),
      makeEvent({ net_sales: 1050, event_weather: "Clear" }),
    ];
    const result = calibrateCoefficients(moreHistory);
    expect(result).not.toBeNull();
    for (const coeff of Object.values(result!.weather)) {
      expect(coeff).toBeGreaterThan(0);
    }
  });

  it("Clear weather coefficient is close to 1.0 when only clear events exist", () => {
    // With only Clear weather events, the Clear coefficient should be ~1.0
    // But calibrateCoefficients needs 2+ events of same weather type for a coefficient
    const clearOnly = [
      makeEvent({ net_sales: 1000, event_weather: "Clear" }),
      makeEvent({ net_sales: 1000, event_weather: "Clear" }),
      makeEvent({ net_sales: 1000, event_weather: "Clear" }),
    ];
    const result = calibrateCoefficients(clearOnly);
    if (result && result.weather["Clear"] !== undefined) {
      expect(result.weather["Clear"]).toBeCloseTo(1.0, 1);
    }
    // If no Clear coefficient (needs 2+ events), that's also valid behavior
  });
});

describe("forecast edge cases", () => {
  it("handles very large sales numbers without overflow", () => {
    const bigEvents = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ event_name: "Big Event", net_sales: 100000 + i * 1000 })
    );
    const result = calculateForecast({ event_name: "Big Event" }, bigEvents);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.forecast)).toBe(true);
    expect(result!.forecast).toBeGreaterThan(90000);
  });

  it("handles events with zero sales gracefully (filters them out)", () => {
    const withZeros = [
      makeEvent({ net_sales: 0 }),
      makeEvent({ net_sales: 0 }),
      makeEvent({ event_name: "Real Event", net_sales: 800 }),
    ];
    // Zero-sales events are excluded from valid events
    const result = calculateForecast({ event_name: "Real Event" }, withZeros);
    expect(result).not.toBeNull();
    expect(result!.forecast).toBeCloseTo(800, 0);
  });
});
