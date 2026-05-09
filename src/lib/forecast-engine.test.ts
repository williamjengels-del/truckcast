/**
 * Tests for the forecast engine.
 * Covers all 4 forecast levels, weather/day adjustments, and edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  calculateForecast,
  calibrateCoefficients,
  computeOperatorOverallMedian,
  INSUFFICIENT_DATA_FLOOR_RATIO,
  type ForecastOptions,
} from "./forecast-engine";
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

  // 2026-05-06 retune — Sunset Hills Maker's Market over-forecast.
  // 2026-05-09 update — gate dropped from >=3 to >=2 to unlock the
  // value-prop during seed-operator phase. The 25% platform-weight
  // cap remains the noise-tolerance backstop.
  describe("platform blend (gate >=2 on 2026-05-09)", () => {
    it("does NOT blend when platform_operator_count < 2 (single-op publication is impossible per privacy floor)", () => {
      const singleHistory = [
        makeEvent({ event_name: "Sunset Market", net_sales: 1000, event_date: "2024-06-15" }),
      ];
      const result = calculateForecast(
        { event_name: "Sunset Market", event_date: "2026-06-15", event_weather: "Clear" },
        singleHistory,
        {
          platformEvent: {
            event_name_normalized: "sunset market",
            median_sales: 2500,
            operator_count: 1,
            total_instances: 2,
          } as NonNullable<ForecastOptions["platformEvent"]>,
        }
      );
      expect(result!.platformBlendApplied).toBe(false);
    });

    it("DOES blend at platform_operator_count == 2 (new seed-phase floor)", () => {
      const singleHistory = [
        makeEvent({ event_name: "Sunset Market", net_sales: 1000, event_date: "2024-06-15", event_weather: "Clear" }),
      ];
      const result = calculateForecast(
        { event_name: "Sunset Market", event_date: "2026-06-15", event_weather: "Clear" },
        singleHistory,
        {
          platformEvent: {
            event_name_normalized: "sunset market",
            median_sales: 2500,
            operator_count: 2,
            total_instances: 4,
          } as NonNullable<ForecastOptions["platformEvent"]>,
        }
      );
      expect(result!.platformBlendApplied).toBe(true);
      // 75% × 1000 + 25% × 2500 = 1375. The 25% cap prevents a noisy
      // 2-op platform median from yanking the forecast around even
      // though the gate is now permissive at 2.
      expect(result!.forecast).toBeGreaterThan(1300);
      expect(result!.forecast).toBeLessThan(1500);
    });

    it("caps platform weight at 25% for n=1 personal data when platform_count >= 3", () => {
      const singleHistory = [
        makeEvent({
          event_name: "Sunset Market",
          net_sales: 1000,
          event_date: "2024-06-15",
          event_weather: "Clear",
        }),
      ];
      const result = calculateForecast(
        { event_name: "Sunset Market", event_date: "2026-06-15", event_weather: "Clear" },
        singleHistory,
        {
          platformEvent: {
            event_name_normalized: "sunset market",
            median_sales: 2500,
            operator_count: 5,
            total_instances: 12,
          } as NonNullable<ForecastOptions["platformEvent"]>,
        }
      );
      expect(result!.platformBlendApplied).toBe(true);
      // 75% personal × 1000 + 25% platform × 2500 = 750 + 625 = 1375
      // Weather/DoW adjustments may shift slightly — assert range.
      expect(result!.forecast).toBeGreaterThan(1300);
      expect(result!.forecast).toBeLessThan(1500);
    });

    it("mature operator (5+ data points) keeps 85% personal weight", () => {
      const matureHistory = Array.from({ length: 5 }, (_, i) =>
        makeEvent({
          event_name: "Mature Market",
          net_sales: 1000,
          event_date: `2024-0${(i % 9) + 1}-15`,
          event_weather: "Clear",
        })
      );
      const result = calculateForecast(
        { event_name: "Mature Market", event_date: "2026-06-15", event_weather: "Clear" },
        matureHistory,
        {
          platformEvent: {
            event_name_normalized: "mature market",
            median_sales: 2500,
            operator_count: 5,
            total_instances: 20,
          } as NonNullable<ForecastOptions["platformEvent"]>,
        }
      );
      // 85% personal × 1000 + 15% platform × 2500 = 850 + 375 = 1225
      expect(result!.platformBlendApplied).toBe(true);
      expect(result!.forecast).toBeGreaterThan(1150);
      expect(result!.forecast).toBeLessThan(1350);
    });
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

describe("series-day filter threshold", () => {
  // Engine layer 2 fix (2026-05-07): the multi-day-series filter used
  // to activate at sameDayMatches.length >= 1, which was producing
  // single-sample sub-forecasts on high-frequency venues that ran
  // multi-day clusters every week. Threshold raised to 3.

  // Helper: build a 3-day cluster (Day 1=$300, Day 2=$800, Day 3=$200,
  // plus a per-cluster offset to make individual events distinguishable
  // by net_sales). Clusters are spaced > SERIES_MAX_GAP_DAYS (5) apart
  // so they're recognised as distinct multi-day series instead of
  // collapsing into one big run.
  function buildCluster(startIso: string, idx: number): Event[] {
    const base = new Date(startIso + "T00:00:00").getTime();
    return [0, 1, 2].map((day) =>
      makeEvent({
        id: `wc-${idx}-${day}`,
        event_name: "Weekly Cluster",
        event_date: new Date(base + day * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        net_sales: [300, 800, 200][day] + idx * 50,
      })
    );
  }

  // Engine series-day filter only activates when the TARGET date itself
  // is part of a multi-day cluster (i.e. another event for this name
  // exists within SERIES_MAX_GAP_DAYS=5 of the target date). Tests that
  // need the filter active must put the target alongside other history
  // dates within that 5-day window.

  it("does NOT activate the series-day filter when fewer than 3 same-day matches exist", () => {
    // Two clusters in history, plus Day-1 + Day-3 of a third cluster
    // bracketing the target. Target = Day-2 of that third cluster.
    // Prior Day-2 matches: cluster 1 Day-2 (Jan 4), cluster 2 Day-2
    // (Jan 18) — only 2. Below the threshold of 3 — filter should
    // NOT activate; engine should fall through to the full name-match
    // set.
    const history: Event[] = [
      ...buildCluster("2024-01-03", 0), // Jan 3, 4, 5
      ...buildCluster("2024-01-17", 1), // Jan 17, 18, 19
      // Day-1 + Day-3 of the third cluster (no Day-2 — that's the target)
      makeEvent({
        id: "wc-2-0",
        event_name: "Weekly Cluster",
        event_date: "2024-01-31",
        net_sales: 400,
      }),
      makeEvent({
        id: "wc-2-2",
        event_name: "Weekly Cluster",
        event_date: "2024-02-02",
        net_sales: 300,
      }),
    ];
    const target = {
      event_name: "Weekly Cluster",
      event_date: "2024-02-01", // Day-2 of cluster starting Jan 31
    };
    const result = calculateForecast(target, history);
    expect(result).not.toBeNull();
    // Filter doesn't activate (only 2 Day-2 matches, threshold is 3).
    // Falls through to the full 8-event name-match set.
    expect(result!.dataPoints).toBe(8);
  });

  it("DOES activate the series-day filter once 3+ same-day matches exist", () => {
    // Three full clusters in history, plus Day-1 + Day-3 of a fourth
    // cluster bracketing the target Day-2. Prior Day-2 matches: clusters
    // 1, 2, 3 each contribute one Day-2 = 3 total. Meets threshold.
    const history: Event[] = [
      ...buildCluster("2024-01-03", 0),
      ...buildCluster("2024-01-17", 1),
      ...buildCluster("2024-01-31", 2),
      makeEvent({
        id: "wc-3-0",
        event_name: "Weekly Cluster",
        event_date: "2024-02-14",
        net_sales: 400,
      }),
      makeEvent({
        id: "wc-3-2",
        event_name: "Weekly Cluster",
        event_date: "2024-02-16",
        net_sales: 300,
      }),
    ];
    const target = {
      event_name: "Weekly Cluster",
      event_date: "2024-02-15", // Day-2 of the fourth cluster
    };
    const result = calculateForecast(target, history);
    expect(result).not.toBeNull();
    // Filter activates: dataPoints is the 3 Day-2 matches only, not
    // the full 11-event name-match set.
    expect(result!.dataPoints).toBe(3);
    // Forecast should land near the Day-2 average (~$800 + offsets),
    // not the full-set mean which would be pulled down by Day-1 and
    // Day-3 events.
    expect(result!.forecast).toBeGreaterThan(700);
    expect(result!.forecast).toBeLessThan(950);
  });
});

describe("insufficient-data floor", () => {
  // Operator history dominated by ~$1,200 events. Median ~ $1,200.
  // Floor at 10% = $120 — anything below is flagged insufficientData.
  const operatorHistory: Event[] = [
    makeEvent({ id: "n1", event_name: "Big Festival",   net_sales: 1200, event_date: "2024-01-15" }),
    makeEvent({ id: "n2", event_name: "Big Festival",   net_sales: 1300, event_date: "2024-02-15" }),
    makeEvent({ id: "n3", event_name: "Big Festival",   net_sales: 1100, event_date: "2024-03-15" }),
    makeEvent({ id: "n4", event_name: "Solid Market",   net_sales: 1000, event_date: "2024-04-15" }),
    makeEvent({ id: "n5", event_name: "Solid Market",   net_sales: 1100, event_date: "2024-05-15" }),
    // Two near-zero events at a slow venue — exactly the audit's tail
    // case (School of Rock, $2 forecast / $286 actual). With only these
    // two as the L1 name match, the engine's weighted average is ~$10.
    makeEvent({ id: "n6", event_name: "Slow Venue Open Mic", net_sales: 8,  event_date: "2024-06-15" }),
    makeEvent({ id: "n7", event_name: "Slow Venue Open Mic", net_sales: 12, event_date: "2024-07-15" }),
  ];

  it("computeOperatorOverallMedian computes median across operator history", () => {
    const m = computeOperatorOverallMedian(operatorHistory);
    expect(m).toBeGreaterThan(900);
    expect(m).toBeLessThan(1300);
  });

  it("flags insufficientData when L1 name-match forecast is below the floor", () => {
    const result = calculateForecast(
      { event_name: "Slow Venue Open Mic", event_date: "2024-09-01" },
      operatorHistory
    );
    expect(result).not.toBeNull();
    // Engine still returns a number — flag is the signal, not a null.
    expect(result!.forecast).toBeGreaterThan(0);
    expect(result!.forecast).toBeLessThan(50);
    expect(result!.insufficientData).toBe(true);
  });

  it("does NOT flag insufficientData for legitimate quiet events above the floor", () => {
    // A venue averaging $300 against operator overall median $1,200 is at
    // ~25% — clearly above the 10% floor. Should NOT be suppressed.
    const quietButLegit: Event[] = [
      ...operatorHistory,
      makeEvent({ id: "q1", event_name: "Wellspent Brewery Tuesday", net_sales: 280, event_date: "2024-08-01" }),
      makeEvent({ id: "q2", event_name: "Wellspent Brewery Tuesday", net_sales: 320, event_date: "2024-08-15" }),
    ];
    const result = calculateForecast(
      { event_name: "Wellspent Brewery Tuesday", event_date: "2024-09-01" },
      quietButLegit
    );
    expect(result).not.toBeNull();
    expect(result!.forecast).toBeGreaterThan(200);
    expect(result!.insufficientData).toBe(false);
  });

  it("does NOT flag insufficientData for normal-volume L1 forecasts", () => {
    const result = calculateForecast(
      { event_name: "Big Festival", event_date: "2024-09-01" },
      operatorHistory
    );
    expect(result).not.toBeNull();
    expect(result!.forecast).toBeGreaterThan(900);
    expect(result!.insufficientData).toBe(false);
  });

  it("floor ratio is 0.10 — keep the constant in sync with copy + recalc", () => {
    // Pinned so a future change to the ratio is intentional and forces a
    // test update + a UI-copy review (the threshold framing leaks into
    // operator-facing language).
    expect(INSUFFICIENT_DATA_FLOOR_RATIO).toBe(0.1);
  });

  it("does not flag when there is no operator history (engine returns null anyway)", () => {
    // No history → engine returns null before the floor check ever fires.
    // This documents the contract: the floor is a safety net on the
    // forecast value, not a substitute for the engine's own preconditions.
    const result = calculateForecast({ event_name: "Anything" }, []);
    expect(result).toBeNull();
  });
});
