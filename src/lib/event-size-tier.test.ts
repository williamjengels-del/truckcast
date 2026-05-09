import { describe, it, expect } from "vitest";
import {
  inferTier,
  effectiveTier,
  computeVenueMediansForTierInference,
  computeLooVenueMediansPerEvent,
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

  it("includes all-history events (no rolling window — coverage beats recency at tier classification layer)", () => {
    // Decision documented in event-size-tier.ts: 2026-05-08 first-recalc
    // audit showed a 12-month window left 215 of 384 events with no
    // usable median. Tier is relative-to-venue, so all-history matters.
    const events = [
      ev("Old Venue", "2024-01-01", 1000),
      ev("Old Venue", "2025-04-01", 800),
      ev("Old Venue", "2025-06-01", 500),
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("old venue")).toBe(800); // median of 500/800/1000
  });

  it("excludes events after asOfDate (forward-looking guard)", () => {
    const events = [
      ev("Venue", "2026-04-01", 100),
      ev("Venue", "2026-09-01", 9000), // future relative to TODAY (2026-05-08)
    ];
    const medians = computeVenueMediansForTierInference(events, TODAY);
    expect(medians.get("venue")).toBe(100);
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
      ev("Venue", "2027-01-01", 500), // future relative to TODAY
      { ...ev("Disrupted", "2026-04-01", 500), anomaly_flag: "disrupted" as const },
      ev("ZeroRev", "2026-04-01", 0),
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

describe("computeLooVenueMediansPerEvent", () => {
  function ev(id: string, name: string, date: string, sales: number, mode: "food_truck" | "catering" = "food_truck") {
    return {
      id,
      event_name: name,
      event_date: date,
      net_sales: mode === "food_truck" ? sales : null,
      invoice_revenue: mode === "catering" ? sales : 0,
      event_mode: mode,
      anomaly_flag: null,
    } as unknown as Parameters<typeof computeLooVenueMediansPerEvent>[0][number];
  }

  const TODAY = "2026-05-08";

  it("excludes the event being inferred from its own venue baseline", () => {
    // The Zach Bryan example from the bug report.
    const events = [
      ev("a", "Music Park", "2026-04-01", 500),
      ev("b", "Music Park", "2026-03-15", 600),
      ev("c", "Music Park", "2026-03-01", 800),
      ev("d", "Music Park", "2026-02-15", 1000),
      ev("zach", "Music Park", "2026-02-01", 2836),
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    // Population median of all 5 = 800. LOO for Zach: median of
    // [500, 600, 800, 1000] = 700. Confirms the under-classification fix.
    expect(looMedians.get("zach")).toBe(700);
    // For event "c" ($800, the population median): LOO of [500,600,1000,2836]
    // = (600 + 1000) / 2 = 800. Different math but happens to land on the
    // same value at this specific datapoint.
    expect(looMedians.get("c")).toBe(800);
  });

  it("returns null for n=1 (no peer)", () => {
    const events = [ev("solo", "Lone Venue", "2026-04-01", 500)];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    expect(looMedians.get("solo")).toBeNull();
  });

  it("handles n=2 (LOO leaves the other one)", () => {
    const events = [
      ev("a", "Pair Venue", "2026-04-01", 100),
      ev("b", "Pair Venue", "2026-03-01", 900),
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    expect(looMedians.get("a")).toBe(900); // median of [900]
    expect(looMedians.get("b")).toBe(100); // median of [100]
  });

  it("returns even-count median when LOO leaves an odd-count remainder of 4", () => {
    // 5 events → remove one → 4 events → median = avg of two middles.
    const events = [
      ev("a", "Venue", "2026-04-01", 100),
      ev("b", "Venue", "2026-03-15", 200),
      ev("c", "Venue", "2026-03-01", 300),
      ev("d", "Venue", "2026-02-15", 400),
      ev("e", "Venue", "2026-02-01", 500),
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    // Removing $300 (the middle) leaves [100,200,400,500]. Median = (200+400)/2 = 300.
    expect(looMedians.get("c")).toBe(300);
    // Removing $100 leaves [200,300,400,500]. Median = (300+400)/2 = 350.
    expect(looMedians.get("a")).toBe(350);
  });

  it("excludes disrupted/boosted/no-revenue events from baseline AND from result", () => {
    const events = [
      ev("good1", "Venue", "2026-04-01", 500),
      ev("good2", "Venue", "2026-03-01", 700),
      { ...ev("bad-disrupted", "Venue", "2026-02-15", 2000), anomaly_flag: "disrupted" as const },
      { ...ev("bad-boosted", "Venue", "2026-02-01", 5000), anomaly_flag: "boosted" as const },
      ev("bad-zero", "Venue", "2026-01-15", 0),
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    expect(looMedians.has("bad-disrupted")).toBe(false);
    expect(looMedians.has("bad-boosted")).toBe(false);
    expect(looMedians.has("bad-zero")).toBe(false);
    // good1 LOO sees only good2 → median = 700
    expect(looMedians.get("good1")).toBe(700);
    expect(looMedians.get("good2")).toBe(500);
  });

  it("excludes future events (asOfDate forward guard)", () => {
    const events = [
      ev("past1", "Venue", "2026-04-01", 100),
      ev("past2", "Venue", "2026-03-01", 200),
      ev("future", "Venue", "2027-01-01", 9999), // future
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    expect(looMedians.has("future")).toBe(false);
    expect(looMedians.get("past1")).toBe(200);
  });

  it("uses invoice_revenue for catering events", () => {
    const events = [
      ev("a", "Wedding", "2026-04-01", 1500, "catering"),
      ev("b", "Wedding", "2026-03-01", 2500, "catering"),
      ev("c", "Wedding", "2026-02-01", 3500, "catering"),
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    expect(looMedians.get("b")).toBe(2500); // median of [1500, 3500]
  });

  it("normalizes event_name to lowercase + trim", () => {
    const events = [
      ev("a", "  Music Park  ", "2026-04-01", 500),
      ev("b", "MUSIC PARK", "2026-03-01", 700),
    ];
    const looMedians = computeLooVenueMediansPerEvent(events, TODAY);
    expect(looMedians.get("a")).toBe(700);
    expect(looMedians.get("b")).toBe(500);
  });
});
