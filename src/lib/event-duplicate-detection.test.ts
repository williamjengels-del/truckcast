import { describe, it, expect } from "vitest";
import { detectDuplicates, type ExistingEvent, type IncomingRow } from "./event-duplicate-detection";

function existing(overrides: Partial<ExistingEvent> & Pick<ExistingEvent, "id" | "event_name" | "event_date">): ExistingEvent {
  return { net_sales: null, ...overrides };
}

describe("detectDuplicates — exact match", () => {
  it("flags identical name + date as exact", () => {
    const incoming: IncomingRow[] = [
      { event_name: "Food Truck Friday", event_date: "2026-05-01" },
    ];
    const existingEvents: ExistingEvent[] = [
      existing({ id: "e1", event_name: "Food Truck Friday", event_date: "2026-05-01", net_sales: 1051 }),
    ];
    const out = detectDuplicates(incoming, existingEvents);
    expect(out).toHaveLength(1);
    expect(out[0].match_type).toBe("exact");
    expect(out[0].existing_event_id).toBe("e1");
    expect(out[0].existing_net_sales).toBe(1051);
  });

  it("normalizes case + trailing whitespace before exact match", () => {
    const out = detectDuplicates(
      [{ event_name: "  food truck FRIDAY ", event_date: "2026-05-01" }],
      [existing({ id: "e1", event_name: "Food Truck Friday", event_date: "2026-05-01" })]
    );
    expect(out).toHaveLength(1);
    expect(out[0].match_type).toBe("exact");
  });

  it("does not match across different dates", () => {
    const out = detectDuplicates(
      [{ event_name: "Food Truck Friday", event_date: "2026-05-08" }],
      [existing({ id: "e1", event_name: "Food Truck Friday", event_date: "2026-05-01" })]
    );
    expect(out).toHaveLength(0);
  });
});

describe("detectDuplicates — fuzzy match (the screenshot bug)", () => {
  // 2026-05-05 capture: two rows on Sat May 2 — "Sunset Hills Maker's
  // Market" (existing) and "Sunset Hill's Maker's Market" (incoming).
  // Apostrophe migrated from "Maker's" to "Hill's". Same date, same
  // city, near-identical name. Old exact-match dedupe slipped this.
  it("catches the 'Sunset Hills' / 'Sunset Hill's' apostrophe drift on the same date", () => {
    const incoming: IncomingRow[] = [
      { event_name: "Sunset Hill's Maker's Market", event_date: "2026-05-02" },
    ];
    const existingEvents: ExistingEvent[] = [
      existing({
        id: "e1",
        event_name: "Sunset Hills Maker's Market",
        event_date: "2026-05-02",
        net_sales: 1058.39,
      }),
    ];
    const out = detectDuplicates(incoming, existingEvents);
    expect(out).toHaveLength(1);
    expect(out[0].match_type).toBe("fuzzy");
    expect(out[0].existing_event_id).toBe("e1");
    expect(out[0].existing_event_name).toBe("Sunset Hills Maker's Market");
    expect(out[0].similarity_score).not.toBeNull();
    expect(out[0].similarity_score!).toBeGreaterThan(0.7);
  });

  it("catches comma-separated variants on the same date", () => {
    // Julian's confirmation: "they're the same event, same time,
    // separated by a comma. I think it's safe to say it was the same event"
    const out = detectDuplicates(
      [{ event_name: "Tower Grove Park, Food Truck Friday", event_date: "2026-05-01" }],
      [existing({ id: "e1", event_name: "Food Truck Friday", event_date: "2026-05-01" })]
    );
    expect(out).toHaveLength(1);
    expect(out[0].match_type).toBe("fuzzy");
  });

  it("does NOT flag genuinely distinct same-date events", () => {
    // Two real events on the same day — must not over-flag.
    const out = detectDuplicates(
      [{ event_name: "Schlafly Tap Room Beer Festival", event_date: "2026-05-02" }],
      [existing({ id: "e1", event_name: "Sunset Hills Maker's Market", event_date: "2026-05-02" })]
    );
    expect(out).toHaveLength(0);
  });

  it("picks the highest-scoring candidate when multiple same-date events exist", () => {
    const out = detectDuplicates(
      [{ event_name: "Sunset Hills Maker's Market", event_date: "2026-05-02" }],
      [
        existing({ id: "e_off", event_name: "Sunset Maker", event_date: "2026-05-02" }),
        existing({ id: "e_close", event_name: "Sunset Hill's Maker's Market", event_date: "2026-05-02" }),
      ]
    );
    expect(out).toHaveLength(1);
    expect(out[0].existing_event_id).toBe("e_close");
  });

  it("prefers exact over fuzzy when both could match on the same date", () => {
    const out = detectDuplicates(
      [{ event_name: "Sunset Hills Maker's Market", event_date: "2026-05-02" }],
      [
        existing({ id: "e_fuzzy", event_name: "Sunset Hill's Maker's Market", event_date: "2026-05-02" }),
        existing({ id: "e_exact", event_name: "Sunset Hills Maker's Market", event_date: "2026-05-02" }),
      ]
    );
    expect(out).toHaveLength(1);
    expect(out[0].match_type).toBe("exact");
    expect(out[0].existing_event_id).toBe("e_exact");
  });
});
