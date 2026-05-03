/**
 * Tests for the engagement signal helpers. These tier boundaries are
 * load-bearing for organizer-side trust (we never expose the count;
 * the copy IS the contract) so worth pinning down with explicit
 * assertions rather than letting them drift.
 */

import { describe, it, expect } from "vitest";
import {
  countEngagedOperators,
  engagementCopyFor,
  engagementSignalForInquiry,
} from "./inquiry-engagement";

describe("countEngagedOperators", () => {
  it("returns 0 for null / undefined / non-object", () => {
    expect(countEngagedOperators(null)).toBe(0);
    expect(countEngagedOperators(undefined)).toBe(0);
    expect(countEngagedOperators({} as Record<string, unknown>)).toBe(0);
  });
  it("counts claimed and contacted as engaged", () => {
    const actions = {
      a: { action: "claimed" },
      b: { action: "contacted" },
    };
    expect(countEngagedOperators(actions)).toBe(2);
  });
  it("does not count declined or absent action", () => {
    const actions = {
      a: { action: "declined" },
      b: { action: "claimed" },
      c: { viewed_at: "2026-05-03" }, // viewed only, no action
    };
    expect(countEngagedOperators(actions)).toBe(1);
  });
  it("ignores malformed slots", () => {
    const actions: Record<string, unknown> = {
      a: { action: "claimed" },
      b: null,
      c: "not-an-object",
      d: { action: "weird-value" },
    };
    expect(countEngagedOperators(actions)).toBe(1);
  });
});

describe("engagementCopyFor — tier boundaries", () => {
  it("returns null below 2", () => {
    expect(engagementCopyFor(0)).toBeNull();
    expect(engagementCopyFor(1)).toBeNull();
  });
  it('returns "On a few operators\' radars" at exactly 2', () => {
    expect(engagementCopyFor(2)).toBe("On a few operators' radars");
  });
  it('returns "Picking up steam" for 3 and 4', () => {
    expect(engagementCopyFor(3)).toBe("Picking up steam");
    expect(engagementCopyFor(4)).toBe("Picking up steam");
  });
  it('returns "Drawing real interest" at 5 and beyond', () => {
    expect(engagementCopyFor(5)).toBe("Drawing real interest");
    expect(engagementCopyFor(50)).toBe("Drawing real interest");
  });
  it("returns null for negatives or non-finite", () => {
    expect(engagementCopyFor(-1)).toBeNull();
    expect(engagementCopyFor(NaN)).toBeNull();
    expect(engagementCopyFor(Infinity)).toBeNull();
  });
});

describe("engagementSignalForInquiry — suppression rules", () => {
  const today = "2026-05-03";
  const future = "2026-06-01";
  const past = "2026-04-01";
  const twoEngaged = {
    a: { action: "claimed" },
    b: { action: "contacted" },
  };

  it("renders copy for an open future-dated inquiry above threshold", () => {
    expect(
      engagementSignalForInquiry({
        operatorActions: twoEngaged,
        eventDate: future,
        status: "open",
        todayIso: today,
      })
    ).toBe("On a few operators' radars");
  });
  it("suppresses when event_date is in the past", () => {
    expect(
      engagementSignalForInquiry({
        operatorActions: twoEngaged,
        eventDate: past,
        status: "open",
        todayIso: today,
      })
    ).toBeNull();
  });
  it("suppresses when status is expired even with future date", () => {
    expect(
      engagementSignalForInquiry({
        operatorActions: twoEngaged,
        eventDate: future,
        status: "expired",
        todayIso: today,
      })
    ).toBeNull();
  });
  it("today's date is not 'past' (date is not yet expired)", () => {
    expect(
      engagementSignalForInquiry({
        operatorActions: twoEngaged,
        eventDate: today,
        status: "open",
        todayIso: today,
      })
    ).toBe("On a few operators' radars");
  });
});
