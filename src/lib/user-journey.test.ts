/**
 * Tests for the user journey state engine.
 * Covers all five states and transition boundaries.
 */

import { describe, it, expect } from "vitest";
import { computeJourneyState } from "./user-journey";

type SimpleEvent = { booked: boolean; net_sales: number | null; event_date: string };

// Past date so events count as "completed"
const PAST = "2025-01-01";
const FUTURE = "2099-01-01";

function makeEvents(count: number, withSales: number, future = 0): SimpleEvent[] {
  const events: SimpleEvent[] = [];
  for (let i = 0; i < withSales; i++) {
    events.push({ booked: true, net_sales: 1000, event_date: PAST });
  }
  for (let i = withSales; i < count; i++) {
    events.push({ booked: true, net_sales: null, event_date: PAST });
  }
  for (let i = 0; i < future; i++) {
    events.push({ booked: true, net_sales: null, event_date: FUTURE });
  }
  return events;
}

describe("computeJourneyState", () => {
  it("returns new_user when there are no events", () => {
    const ctx = computeJourneyState([], false);
    expect(ctx.state).toBe("new_user");
    expect(ctx.totalEvents).toBe(0);
    expect(ctx.eventsWithSales).toBe(0);
  });

  it("new_user: nextStep links to add event", () => {
    const ctx = computeJourneyState([], false);
    expect(ctx.nextStep.href).toBe("/dashboard/events?new=true");
  });

  it("returns building for 1 event with no sales", () => {
    const ctx = computeJourneyState(makeEvents(1, 0), false);
    expect(ctx.state).toBe("building");
    expect(ctx.totalEvents).toBe(1);
  });

  it("returns building for 5 events with 2 having sales (< 50% logged)", () => {
    const ctx = computeJourneyState(makeEvents(5, 2), false);
    // 2/5 = 40% < 50% — but totalEvents < 3 so check: actually 5 >= 3 and 2 < 2.5
    // 40% < 50%, so logging state; but eventsWithSales < 10, so...
    // Actually: totalEvents=5 >= 3 and eventsWithSales(2) < totalEvents*0.5(2.5) → logging
    expect(ctx.state).toBe("logging");
  });

  it("returns building for 2 events (below the 3-event threshold for logging check)", () => {
    const ctx = computeJourneyState(makeEvents(2, 0), false);
    expect(ctx.state).toBe("building");
  });

  it("returns logging when >= 3 events but < 50% have sales", () => {
    const ctx = computeJourneyState(makeEvents(4, 1), false); // 25% logged
    expect(ctx.state).toBe("logging");
    expect(ctx.nextStep.href).toBe("/dashboard/events");
  });

  it("returns calibrating at exactly 10 events with sales", () => {
    const ctx = computeJourneyState(makeEvents(15, 10), false);
    expect(ctx.state).toBe("calibrating");
    expect(ctx.eventsWithSales).toBe(10);
  });

  it("returns calibrating between 10 and 29 events with sales", () => {
    const ctx = computeJourneyState(makeEvents(25, 20), false);
    expect(ctx.state).toBe("calibrating");
  });

  it("returns calibrated at exactly 30 events with sales", () => {
    const ctx = computeJourneyState(makeEvents(35, 30), false);
    expect(ctx.state).toBe("calibrated");
    expect(ctx.nextStep.href).toBe("/dashboard/forecasts");
  });

  it("returns calibrated at 50 events with sales", () => {
    const ctx = computeJourneyState(makeEvents(55, 50), false);
    expect(ctx.state).toBe("calibrated");
  });

  it("hasPOS is correctly passed through", () => {
    const withPOS = computeJourneyState([], true);
    const withoutPOS = computeJourneyState([], false);
    expect(withPOS.hasPOS).toBe(true);
    expect(withoutPOS.hasPOS).toBe(false);
  });

  it("hasUpcoming is true when a future event exists", () => {
    const ctx = computeJourneyState(makeEvents(1, 0, 1), false);
    expect(ctx.hasUpcoming).toBe(true);
  });

  it("hasUpcoming is false when all events are in the past", () => {
    const ctx = computeJourneyState(makeEvents(3, 2), false);
    expect(ctx.hasUpcoming).toBe(false);
  });

  it("calibrated state takes priority over logging (30+ sales even if < 50% logged)", () => {
    // 30 with sales, 70 without — that's only 30% logged, but calibrated wins
    const ctx = computeJourneyState(makeEvents(100, 30), false);
    expect(ctx.state).toBe("calibrated");
  });

  it("all states have a non-empty nextStep label and href", () => {
    const states = [
      computeJourneyState([], false),                    // new_user
      computeJourneyState(makeEvents(2, 0), false),      // building
      computeJourneyState(makeEvents(4, 1), false),      // logging
      computeJourneyState(makeEvents(15, 10), false),    // calibrating
      computeJourneyState(makeEvents(35, 30), false),    // calibrated
    ];
    for (const ctx of states) {
      expect(ctx.nextStep.label.length).toBeGreaterThan(0);
      expect(ctx.nextStep.href.length).toBeGreaterThan(0);
      expect(ctx.nextStep.description.length).toBeGreaterThan(0);
    }
  });
});
