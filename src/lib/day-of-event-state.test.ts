import { describe, it, expect } from "vitest";
import { computeDayOfState } from "./day-of-event-state";
import { wallclockInZoneToUtcMs } from "./wallclock-tz";
import type { Event } from "./database.types";

const TZ = "America/Chicago";

function makeEvent(partial: Partial<Event> & { id: string; event_date: string }): Event {
  const base: Event = {
    id: partial.id,
    user_id: "u1",
    event_name: "Lunchtime Live",
    event_date: partial.event_date,
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

describe("computeDayOfState", () => {
  it('returns "today" with current event when service is live', () => {
    const events = [
      makeEvent({
        id: "a",
        event_date: "2026-04-29",
        start_time: "11:30",
        end_time: "13:30",
      }),
    ];
    // Now: 12:00 PM CDT on 2026-04-29 (mid-service)
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "12:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.kind).toBe("today");
    expect(state.current?.id).toBe("a");
    expect(state.upcomingToday).toHaveLength(0);
  });

  it("stacks today's events: current + up next when both still active", () => {
    // 2026-05-05 multi-event case from spec test list:
    // 11:30-13:30 Corporate Lunch + 15:30-18:00 Veteran's Fundraiser.
    const events = [
      makeEvent({
        id: "lunch",
        event_date: "2026-05-05",
        start_time: "11:30",
        end_time: "13:30",
      }),
      makeEvent({
        id: "vets",
        event_date: "2026-05-05",
        start_time: "15:30",
        end_time: "18:00",
      }),
    ];
    // Now: 12:00 PM CDT on 2026-05-05 (lunch live, vets queued)
    const nowMs = wallclockInZoneToUtcMs("2026-05-05", "12:00", TZ)!;
    const state = computeDayOfState(events, "2026-05-05", nowMs, TZ);
    expect(state.kind).toBe("today");
    expect(state.current?.id).toBe("lunch");
    expect(state.upcomingToday).toHaveLength(1);
    expect(state.upcomingToday[0].id).toBe("vets");
  });

  it("auto-ends and promotes the next today event after first ends", () => {
    const events = [
      makeEvent({
        id: "lunch",
        event_date: "2026-05-05",
        start_time: "11:30",
        end_time: "13:30",
      }),
      makeEvent({
        id: "vets",
        event_date: "2026-05-05",
        start_time: "15:30",
        end_time: "18:00",
      }),
    ];
    // Now: 14:00 PM (between lunch end and vets start)
    const nowMs = wallclockInZoneToUtcMs("2026-05-05", "14:00", TZ)!;
    const state = computeDayOfState(events, "2026-05-05", nowMs, TZ);
    expect(state.kind).toBe("today");
    expect(state.current?.id).toBe("vets");
    expect(state.upcomingToday).toHaveLength(0);
    // Lunch should appear in endedTodayIds for the lazy audit write.
    expect(state.endedTodayIds).toContain("lunch");
  });

  it("falls back to tomorrow when all today events ended", () => {
    const events = [
      makeEvent({
        id: "today-done",
        event_date: "2026-04-29",
        start_time: "11:30",
        end_time: "13:30",
      }),
      makeEvent({
        id: "tomorrow",
        event_date: "2026-04-30",
        start_time: "11:30",
        end_time: "13:30",
      }),
    ];
    // Now: 14:00 PM today — today's done.
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "14:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.kind).toBe("tomorrow");
    expect(state.current?.id).toBe("tomorrow");
  });

  it('falls back to "future" when no today and no tomorrow event', () => {
    const events = [
      makeEvent({
        id: "next-week",
        event_date: "2026-05-06",
      }),
    ];
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "14:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.kind).toBe("future");
    expect(state.current?.id).toBe("next-week");
  });

  it('returns "none" when no events scheduled', () => {
    const state = computeDayOfState([], "2026-04-29", Date.now(), TZ);
    expect(state.kind).toBe("none");
    expect(state.current).toBeNull();
  });

  it("respects pre-set auto_ended_at — does not pick that event as current", () => {
    const events = [
      makeEvent({
        id: "manually-ended",
        event_date: "2026-04-29",
        start_time: "11:30",
        end_time: "13:30",
        auto_ended_at: "2026-04-29T18:00:00Z",
      }),
      makeEvent({
        id: "still-live",
        event_date: "2026-04-29",
        start_time: "15:00",
        end_time: "17:00",
      }),
    ];
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "16:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.current?.id).toBe("still-live");
  });

  it("treats null end_time as still active until tomorrow rolls over", () => {
    const events = [
      makeEvent({
        id: "no-end-time",
        event_date: "2026-04-29",
        start_time: "11:30",
        end_time: null,
      }),
    ];
    // Late evening of the event date — still active per spec.
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "23:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.kind).toBe("today");
    expect(state.current?.id).toBe("no-end-time");
  });

  it("surfaces needsWrapUp for the most-recently-ended event without a summary", () => {
    const events = [
      makeEvent({
        id: "lunch",
        event_date: "2026-04-29",
        start_time: "11:30",
        end_time: "13:30",
      }),
      makeEvent({
        id: "vets",
        event_date: "2026-04-29",
        start_time: "15:30",
        end_time: "18:00",
      }),
    ];
    // Now: 19:00 — both ended.
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "19:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.needsWrapUp?.id).toBe("vets"); // most recent
  });

  it("does not surface needsWrapUp when summary already saved", () => {
    const events = [
      makeEvent({
        id: "lunch",
        event_date: "2026-04-29",
        start_time: "11:30",
        end_time: "13:30",
        after_event_summary: {
          final_sales: 1100,
          wrap_up_note: "Crushed it",
          what_id_change: null,
        },
      }),
    ];
    const nowMs = wallclockInZoneToUtcMs("2026-04-29", "14:00", TZ)!;
    const state = computeDayOfState(events, "2026-04-29", nowMs, TZ);
    expect(state.needsWrapUp).toBeNull();
  });

  it("handles zero-duration event without crashing (Ellisville Concert spec case)", () => {
    // Spec test case: setup_time = start_time = end_time = 23:02.
    // VendCast schema can't reproduce the Airtable storage corruption,
    // but the operator may type all three as the same value. Card
    // should mark as ended at exactly 23:02 (end >= now), no NaN /
    // division-by-zero / negative countdown surfacing.
    const events = [
      makeEvent({
        id: "ellisville",
        event_date: "2026-05-28",
        setup_time: "23:02",
        start_time: "23:02",
        end_time: "23:02",
      }),
    ];
    // Now: 23:03 — one minute past zero-duration end.
    const nowMs = wallclockInZoneToUtcMs("2026-05-28", "23:03", TZ)!;
    const state = computeDayOfState(events, "2026-05-28", nowMs, TZ);
    expect(state.kind).toBe("none");
    expect(state.needsWrapUp?.id).toBe("ellisville");
    expect(state.endedTodayIds).toContain("ellisville");
  });

  it("handles events with end_time crossing into next UTC day", () => {
    // Spec test case: Food Truck Friday 2026-05-01 8 PM CDT end =
    // 2026-05-02 01:00 UTC. Event date = 2026-05-01.
    const events = [
      makeEvent({
        id: "ftf",
        event_date: "2026-05-01",
        start_time: "17:00",
        end_time: "20:00",
      }),
    ];
    // Now: 18:30 PM local on 2026-05-01 — still live.
    const nowMs = wallclockInZoneToUtcMs("2026-05-01", "18:30", TZ)!;
    const state = computeDayOfState(events, "2026-05-01", nowMs, TZ);
    expect(state.kind).toBe("today");
    expect(state.current?.id).toBe("ftf");

    // Now: 21:00 PM local — ended.
    const lateNow = wallclockInZoneToUtcMs("2026-05-01", "21:00", TZ)!;
    const lateState = computeDayOfState(events, "2026-05-01", lateNow, TZ);
    expect(lateState.kind).toBe("none");
    expect(lateState.endedTodayIds).toContain("ftf");
  });
});
