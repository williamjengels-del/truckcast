import { describe, it, expect } from "vitest";
import {
  inferTier,
  effectiveTier,
  computeVenueMediansForTierInference,
  TIER_THRESHOLDS,
} from "./event-size-tier";

describe("inferTier", () => {
  it("returns null when actual revenue is missing", () => {
    expect(inferTier(null, 500)).toBeNull();
    expect(inferTier(undefined, 500)).toBeNull();
    expect(inferTier(0, 500)).toBeNull();
  });

  it("returns null when venue median is missing", () => {
    expect(inferTier(800, null)).toBeNull();
    expect(inferTier(800, undefined)).toBeNull();
    expect(inferTier(800, 0)).toBeNull();
  });

  it("returns null when actual is negative (defensive)", () => {
    expect(inferTier(-100, 500)).toBeNull();
  });

  // Boundary tests using the documented thresholds (0.5×, 2×, 4×).
  it("classifies SMALL at exactly 0.5× venue median", () => {
    expect(inferTier(250, 500)).toBe("SMALL");
  });

  it("classifies SMALL just below 0.5×", () => {
    expect(inferTier(249, 500)).toBe("SMALL");
  });

  it("classifies NORMAL just above 0.5× (50.2%)", () => {
    expect(inferTier(251, 500)).toBe("NORMAL");
  });

  it("classifies NORMAL at the median", () => {
    expect(inferTier(500, 500)).toBe("NORMAL");
  });

  it("classifies NORMAL at exactly 2× venue median", () => {
    expect(inferTier(1000, 500)).toBe("NORMAL");
  });

  it("classifies LARGE just above 2×", () => {
    expect(inferTier(1001, 500)).toBe("LARGE");
  });

  it("classifies LARGE at exactly 4× venue median", () => {
    expect(inferTier(2000, 500)).toBe("LARGE");
  });

  it("classifies FLAGSHIP just above 4×", () => {
    expect(inferTier(2001, 500)).toBe("FLAGSHIP");
  });

  it("classifies FLAGSHIP for an extreme outlier", () => {
    // Zach Bryan night — $2836 vs $592 venue median = 4.79×
    expect(inferTier(2836, 592)).toBe("FLAGSHIP");
  });

  it("uses the exported TIER_THRESHOLDS constants (no magic numbers)", () => {
    // If someone changes a threshold without updating tests, this catches it.
    expect(TIER_THRESHOLDS.small).toBe(0.5);
    expect(TIER_THRESHOLDS.large).toBe(2.0);
    expect(TIER_THRESHOLDS.flagship).toBe(4.0);
  });
});

describe("effectiveTier", () => {
  it("returns operator override when set", () => {
    expect(
      effectiveTier({
        event_size_tier_operator: "FLAGSHIP",
        event_size_tier_inferred: "NORMAL",
      })
    ).toBe("FLAGSHIP");
  });

  it("returns inferred when operator is null", () => {
    expect(
      effectiveTier({
        event_size_tier_operator: null,
        event_size_tier_inferred: "LARGE",
      })
    ).toBe("LARGE");
  });

  it("defaults to NORMAL when both are null", () => {
    expect(
      effectiveTier({
        event_size_tier_operator: null,
        event_size_tier_inferred: null,
      })
    ).toBe("NORMAL");
  });

  it("defaults to NORMAL when both are undefined (column-doesn't-exist case)", () => {
    expect(
      effectiveTier({
        event_size_tier_operator: undefined,
        event_size_tier_inferred: undefined,
      })
    ).toBe("NORMAL");
  });

  it("normalizes lowercased values from manually-edited rows", () => {
    expect(
      effectiveTier({
        event_size_tier_operator: "flagship" as never,
        event_size_tier_inferred: null,
      })
    ).toBe("FLAGSHIP");
  });

  it("ignores garbage values and falls through (defensive)", () => {
    expect(
      effectiveTier({
        event_size_tier_operator: "BIG" as never,
        event_size_tier_inferred: "LARGE",
      })
    ).toBe("LARGE");
  });
});

describe("computeVenueMediansForTierInference", () => {
  function ev(name: string, date: string, sales: number, mode: "food_truck" | "catering" = "food_truck") {
    return {
      event_name: name,
      event_date: date,
      net_sales: mode === "food_truck" ? sales : null,
      invoice_revenue: mode === "catering" ? sales : 0,
      event_mode: mode,
      anomaly_flag: null,
    } as unknown as Parameters<typeof computeVenueMediansForTierInference>[0][number];
  }

  const TODAY = "2026-05-08";

  it("computes median per event_name in the 12-month window", () => {
    const events = [
      ev("Music Park", "2026-04-01", 500),
      ev("Music Park", "2026-03-01", 600),
      ev("Music Park", "2026-02-01", 700),
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("music park")).toBe(600);
  });

  it("returns even-count median as average of two middle values", () => {
    const events = [
      ev("Venue", "2026-04-01", 100),
      ev("Venue", "2026-03-01", 200),
      ev("Venue", "2026-02-01", 300),
      ev("Venue", "2026-01-01", 400),
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("venue")).toBe(250); // (200 + 300) / 2
  });

  it("excludes events older than 12 months", () => {
    const events = [
      ev("Old Venue", "2024-01-01", 1000), // > 12 mo, excluded
      ev("Old Venue", "2025-04-01", 800),  // 13 mo back from 2026-05-08, excluded
      ev("Old Venue", "2025-06-01", 500),  // 11 mo back, kept
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    // Only the 2025-06-01 event survives the 12-month window from 2026-05-08
    expect(medians.get("old venue")).toBe(500);
  });

  it("uses invoice_revenue for catering events", () => {
    const events = [
      ev("Wedding", "2026-04-01", 1500, "catering"),
      ev("Wedding", "2026-03-01", 2000, "catering"),
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("wedding")).toBe(1750);
  });

  it("excludes disrupted and boosted events", () => {
    const events = [
      { ...ev("Venue", "2026-04-01", 500), anomaly_flag: "disrupted" as const },
      ev("Venue", "2026-03-01", 1000),
      { ...ev("Venue", "2026-02-01", 5000), anomaly_flag: "boosted" as const },
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    // Only the 2026-03-01 event with no flag counts
    expect(medians.get("venue")).toBe(1000);
  });

  it("excludes events with zero or null revenue", () => {
    const events = [
      ev("Venue", "2026-04-01", 0),
      ev("Venue", "2026-03-01", 500),
      { ...ev("Venue", "2026-02-01", 0), net_sales: null },
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("venue")).toBe(500);
  });

  it("returns empty map when no eligible events", () => {
    const events = [
      ev("Venue", "2024-01-01", 500), // too old
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.size).toBe(0);
  });

  it("normalizes event_name to lowercase + trim", () => {
    const events = [
      ev("  Music Park  ", "2026-04-01", 500),
      ev("MUSIC PARK", "2026-03-01", 700),
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("music park")).toBe(600);
  });
});
