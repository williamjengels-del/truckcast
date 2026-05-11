import { describe, it, expect } from "vitest";
import {
  CHIP_CATALOG,
  TAB_DEFAULT_CHIPS,
  applyChips,
  toggleChip,
  chipsToParam,
  chipsFromParam,
  eventInTabScope,
  legacyUrlMapping,
  isValidTab,
} from "./events-chips";
import type { Event } from "./database.types";

const TODAY = "2026-04-30";

function makeEvent(partial: Partial<Event> & { id: string }): Event {
  const base: Event = {
    id: partial.id,
    user_id: "u1",
    event_name: "Lunchtime Live",
    event_date: TODAY,
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
  };
  return { ...base, ...partial };
}

describe("CHIP_CATALOG", () => {
  it("has unique chip IDs", () => {
    const ids = CHIP_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("ships at least the locked chip set", () => {
    const ids = CHIP_CATALOG.map((c) => c.id);
    expect(ids).toContain("booked");
    expect(ids).toContain("unbooked");
    expect(ids).toContain("cancelled");
    expect(ids).toContain("missing-type");
    expect(ids).toContain("missing-weather");
    expect(ids).toContain("missing-location");
    expect(ids).toContain("missing-address");
    expect(ids).toContain("missing-sales");
  });

  it("missing-address fires only on empty/missing location, ignoring city", () => {
    const chip = CHIP_CATALOG.find((c) => c.id === "missing-address")!;
    expect(chip).toBeDefined();
    // Empty location → fires regardless of city
    expect(chip.predicate(makeEvent({ id: "e1", location: null, city: "St. Louis" }), "2026-05-11")).toBe(true);
    expect(chip.predicate(makeEvent({ id: "e1", location: "", city: "St. Louis" }), "2026-05-11")).toBe(true);
    expect(chip.predicate(makeEvent({ id: "e1", location: "   ", city: "St. Louis" }), "2026-05-11")).toBe(true);
    // Address present → does not fire
    expect(chip.predicate(makeEvent({ id: "e1", location: "Forest Park" }), "2026-05-11")).toBe(false);
    expect(chip.predicate(makeEvent({ id: "e1", location: "1234 Locust St" }), "2026-05-11")).toBe(false);
    // Distinct from missing-location, which falls back to city presence
    const missingLoc = CHIP_CATALOG.find((c) => c.id === "missing-location")!;
    expect(missingLoc.predicate(makeEvent({ id: "e1", location: null, city: "St. Louis" }), "2026-05-11")).toBe(false);
    expect(chip.predicate(makeEvent({ id: "e1", location: null, city: "St. Louis" }), "2026-05-11")).toBe(true);
  });
  it("status chips are radio-in-category, field chips are not", () => {
    for (const c of CHIP_CATALOG) {
      if (c.category === "status") expect(c.radioInCategory).toBe(true);
      if (c.category === "field") expect(c.radioInCategory).toBe(false);
    }
  });
});

describe("TAB_DEFAULT_CHIPS", () => {
  it("upcoming + past pre-select booked", () => {
    expect(TAB_DEFAULT_CHIPS.upcoming).toEqual(["booked"]);
    expect(TAB_DEFAULT_CHIPS.past).toEqual(["booked"]);
  });
  it("all + needs_attention have no defaults", () => {
    expect(TAB_DEFAULT_CHIPS.all).toEqual([]);
    expect(TAB_DEFAULT_CHIPS.needs_attention).toEqual([]);
  });
});

describe("toggleChip — radio behavior in status", () => {
  it("adds a chip when not present", () => {
    const next = toggleChip(new Set(), "booked");
    expect([...next]).toEqual(["booked"]);
  });
  it("removes a chip when already present", () => {
    const next = toggleChip(new Set(["booked"]), "booked");
    expect([...next]).toEqual([]);
  });
  it("clears other status chips when adding a status chip (radio)", () => {
    const next = toggleChip(new Set(["booked"]), "cancelled");
    expect([...next].sort()).toEqual(["cancelled"]);
  });
  it("does NOT clear field chips when adding a status chip", () => {
    const next = toggleChip(new Set(["missing-type"]), "booked");
    expect([...next].sort()).toEqual(["booked", "missing-type"]);
  });
  it("does NOT clear other field chips when adding a field chip (multi-select)", () => {
    const next = toggleChip(new Set(["missing-type"]), "missing-weather");
    expect([...next].sort()).toEqual(["missing-type", "missing-weather"]);
  });
  it("ignores unknown chip IDs (returns input unchanged)", () => {
    const next = toggleChip(new Set(["booked"]), "unknown-chip");
    expect([...next]).toEqual(["booked"]);
  });
});

describe("applyChips — composition", () => {
  const booked = makeEvent({ id: "a", booked: true, event_type: "Festival" });
  const unbooked = makeEvent({
    id: "b",
    booked: false,
    event_type: "Festival",
  });
  const cancelled = makeEvent({
    id: "c",
    booked: true,
    cancellation_reason: "weather",
    event_type: "Festival",
    event_weather: "Storms",
    city: "St Louis",
  });
  const missingType = makeEvent({
    id: "d",
    booked: true,
    event_type: null,
    event_weather: "Clear",
  });
  const missingTypeAndWeather = makeEvent({
    id: "e",
    booked: true,
    event_type: null,
    event_weather: null,
  });
  const all = [booked, unbooked, cancelled, missingType, missingTypeAndWeather];

  it("empty chip set is identity", () => {
    expect(applyChips(all, new Set(), TODAY)).toHaveLength(all.length);
  });

  it("booked chip filters to booked events only", () => {
    const got = applyChips(all, new Set(["booked"]), TODAY);
    expect(got.map((e) => e.id).sort()).toEqual(
      ["a", "d", "e"].sort()
    );
  });

  it("cancelled chip filters to cancellation-reason rows", () => {
    const got = applyChips(all, new Set(["cancelled"]), TODAY);
    expect(got.map((e) => e.id)).toEqual(["c"]);
  });

  it("missing-type chip + missing-weather chip composes AND", () => {
    const got = applyChips(
      all,
      new Set(["missing-type", "missing-weather"]),
      TODAY
    );
    // Only event 'e' has BOTH missing.
    expect(got.map((e) => e.id)).toEqual(["e"]);
  });

  it("status + field chips compose AND across categories", () => {
    const got = applyChips(
      all,
      new Set(["booked", "missing-type"]),
      TODAY
    );
    // 'd' and 'e' are booked + missing type. 'a' is booked + has type.
    expect(got.map((e) => e.id).sort()).toEqual(["d", "e"].sort());
  });
});

describe("eventInTabScope", () => {
  const future = makeEvent({ id: "future", event_date: "2026-05-15" });
  const todayEvt = makeEvent({ id: "today", event_date: TODAY });
  const past = makeEvent({ id: "past", event_date: "2026-04-01" });

  it("all tab is unscoped", () => {
    expect(eventInTabScope(future, "all", TODAY)).toBe(true);
    expect(eventInTabScope(past, "all", TODAY)).toBe(true);
  });

  it('upcoming includes today + future', () => {
    expect(eventInTabScope(future, "upcoming", TODAY)).toBe(true);
    expect(eventInTabScope(todayEvt, "upcoming", TODAY)).toBe(true);
    expect(eventInTabScope(past, "upcoming", TODAY)).toBe(false);
  });

  // 2026-05-06 operator report: Upcoming count was inflated to ~90
  // because cancelled-but-future-dated bookings still counted. The
  // tab now excludes them — they remain visible on the All tab and
  // via the Cancelled status chip.
  it("upcoming excludes cancelled-but-future-dated rows", () => {
    const cancelledFuture = makeEvent({
      id: "cf",
      event_date: "2026-06-15",
      cancellation_reason: "organizer_cancelled",
    });
    expect(eventInTabScope(cancelledFuture, "upcoming", TODAY)).toBe(false);
  });

  it("upcoming excludes sold-out-cancelled future rows", () => {
    const soldOutFuture = makeEvent({
      id: "sof",
      event_date: "2026-07-01",
      cancellation_reason: "sold_out",
    });
    expect(eventInTabScope(soldOutFuture, "upcoming", TODAY)).toBe(false);
  });

  it("past excludes today (today is upcoming until end-of-day)", () => {
    expect(eventInTabScope(past, "past", TODAY)).toBe(true);
    expect(eventInTabScope(todayEvt, "past", TODAY)).toBe(false);
  });

  it("needs_attention is true when ANY field is missing", () => {
    const missingType = makeEvent({
      id: "m",
      event_date: TODAY,
      event_type: null,
      event_weather: "Clear",
      city: "St Louis",
    });
    expect(eventInTabScope(missingType, "needs_attention", TODAY)).toBe(true);
  });

  it("needs_attention is false when all critical fields are present (and not missing-sales-eligible)", () => {
    const complete = makeEvent({
      id: "c",
      event_date: "2026-05-15",
      event_type: "Festival",
      event_weather: "Clear",
      city: "St Louis",
      net_sales: 1000,
    });
    expect(eventInTabScope(complete, "needs_attention", TODAY)).toBe(false);
  });
});

describe("URL plumbing", () => {
  it("chipsToParam serializes alphabetized comma list", () => {
    expect(chipsToParam(new Set(["booked", "missing-type"]))).toBe(
      "booked,missing-type"
    );
    // Order independence — alphabetical for stable URL.
    expect(chipsToParam(new Set(["missing-type", "booked"]))).toBe(
      "booked,missing-type"
    );
  });

  it("chipsToParam empty set is empty string", () => {
    expect(chipsToParam(new Set())).toBe("");
  });

  it("chipsFromParam round-trips known IDs", () => {
    const got = chipsFromParam("booked,missing-weather");
    expect([...got].sort()).toEqual(["booked", "missing-weather"].sort());
  });

  it("chipsFromParam silently drops unknown IDs", () => {
    const got = chipsFromParam("booked,bogus,missing-type");
    expect([...got].sort()).toEqual(["booked", "missing-type"].sort());
  });

  it("chipsFromParam null returns empty", () => {
    expect(chipsFromParam(null).size).toBe(0);
  });
});

describe("legacyUrlMapping", () => {
  it("maps ?tab=flagged to needs_attention + missing-sales", () => {
    const got = legacyUrlMapping("flagged", null);
    expect(got?.tab).toBe("needs_attention");
    expect([...(got?.chips ?? [])]).toEqual(["missing-sales"]);
  });

  it("maps ?tab=cancelled to past + cancelled chip", () => {
    const got = legacyUrlMapping("cancelled", null);
    expect(got?.tab).toBe("past");
    expect([...(got?.chips ?? [])]).toEqual(["cancelled"]);
  });

  it("maps ?tab=past_unbooked to past + unbooked chip", () => {
    const got = legacyUrlMapping("past_unbooked", null);
    expect(got?.tab).toBe("past");
    expect([...(got?.chips ?? [])]).toEqual(["unbooked"]);
  });

  it("maps ?missing=type to needs_attention + missing-type chip", () => {
    const got = legacyUrlMapping(null, "type");
    expect(got?.tab).toBe("needs_attention");
    expect([...(got?.chips ?? [])]).toEqual(["missing-type"]);
  });

  it("?missing= takes precedence over ?tab=", () => {
    const got = legacyUrlMapping("upcoming", "weather");
    expect(got?.tab).toBe("needs_attention");
    expect([...(got?.chips ?? [])]).toEqual(["missing-weather"]);
  });

  it("returns null for unmappable inputs", () => {
    expect(legacyUrlMapping(null, null)).toBeNull();
    expect(legacyUrlMapping("nonsense", null)).toBeNull();
  });

  it("normalizes 'needs-attention' (kebab) to 'needs_attention'", () => {
    const got = legacyUrlMapping("needs-attention", null);
    expect(got?.tab).toBe("needs_attention");
  });
});

describe("isValidTab", () => {
  it("accepts valid tabs", () => {
    expect(isValidTab("all")).toBe(true);
    expect(isValidTab("upcoming")).toBe(true);
    expect(isValidTab("past")).toBe(true);
    expect(isValidTab("needs_attention")).toBe(true);
  });
  it("rejects legacy and unknown values", () => {
    expect(isValidTab("flagged")).toBe(false);
    expect(isValidTab("unbooked")).toBe(false);
    expect(isValidTab(null)).toBe(false);
    expect(isValidTab("nonsense")).toBe(false);
  });
});
