import { describe, it, expect } from "vitest";
import { findSalesComparable } from "./sales-pace";
import type { Event } from "./database.types";

// Minimal stub for the supabase chain. Each method returns `this`
// until `.eq` / `.is` etc. — we capture filters and resolve when
// `.then` is awaited (Promise interface). Sales-pace makes 1-3
// sequential queries; we stub a sequence of return values.
type Row = { net_sales: number };

function makeStub(returns: Row[][]) {
  let callIdx = 0;
  // Each query is built as: from(events).select(...).eq(...).neq(...)...
  // The methods we use: .from, .select, .eq, .neq, .is, .gt
  // The terminal `await` resolves to `{ data, error }`.
  const builder = () => {
    const filters: { method: string; field: string; value: unknown }[] = [];
    const proxy: Record<string, unknown> = {};
    const allMethods = ["from", "select", "eq", "neq", "is", "gt"];
    for (const m of allMethods) {
      proxy[m] = (...args: unknown[]) => {
        filters.push({ method: m, field: String(args[0] ?? ""), value: args[1] });
        return proxy;
      };
    }
    proxy.then = (resolve: (v: { data: Row[]; error: null }) => void) => {
      const rows = returns[callIdx] ?? [];
      callIdx++;
      resolve({ data: rows, error: null });
    };
    return proxy;
  };
  return {
    from() {
      return builder();
    },
  };
}

const baseEvent: Pick<Event, "id" | "event_name" | "location" | "event_mode"> = {
  id: "evt-current",
  event_name: "Lunchtime Live",
  location: "Old Post Office Plaza",
  event_mode: "food_truck",
};

describe("findSalesComparable", () => {
  it("returns name_and_venue when prior events match both", async () => {
    const stub = makeStub([
      // Tier 1: 3 prior events, $1000 / $1100 / $900 = avg 1000
      [{ net_sales: 1000 }, { net_sales: 1100 }, { net_sales: 900 }],
    ]);
    const got = await findSalesComparable(stub, "user-1", baseEvent);
    expect(got).not.toBeNull();
    expect(got!.source).toBe("name_and_venue");
    expect(got!.avgSales).toBe(1000);
    expect(got!.sampleCount).toBe(3);
    expect(got!.label).toContain("Lunchtime Live");
    expect(got!.label).toContain("Old Post Office Plaza");
  });

  it("falls back to name when name+venue empty", async () => {
    const stub = makeStub([
      [], // tier 1 empty
      [{ net_sales: 800 }, { net_sales: 1200 }], // tier 2 hits — avg 1000
    ]);
    const got = await findSalesComparable(stub, "user-1", baseEvent);
    expect(got).not.toBeNull();
    expect(got!.source).toBe("name");
    expect(got!.avgSales).toBe(1000);
    expect(got!.sampleCount).toBe(2);
  });

  it("falls back to venue when name+venue and name empty", async () => {
    const stub = makeStub([
      [], // tier 1 empty
      [], // tier 2 empty
      [{ net_sales: 700 }, { net_sales: 800 }, { net_sales: 600 }], // tier 3 — avg 700
    ]);
    const got = await findSalesComparable(stub, "user-1", baseEvent);
    expect(got).not.toBeNull();
    expect(got!.source).toBe("venue");
    expect(got!.avgSales).toBe(700);
    expect(got!.sampleCount).toBe(3);
    expect(got!.label).toContain("Old Post Office Plaza");
  });

  it("returns null when all three tiers empty", async () => {
    const stub = makeStub([[], [], []]);
    const got = await findSalesComparable(stub, "user-1", baseEvent);
    expect(got).toBeNull();
  });

  it("returns null for catering events without querying", async () => {
    const stub = makeStub([[{ net_sales: 5000 }]]); // would match if asked
    const got = await findSalesComparable(stub, "user-1", {
      ...baseEvent,
      event_mode: "catering",
    });
    expect(got).toBeNull();
  });

  it("skips tier 1 + tier 3 when location is null (only tries tier 2)", async () => {
    const stub = makeStub([
      [{ net_sales: 1500 }], // tier 2 — avg 1500
    ]);
    const got = await findSalesComparable(stub, "user-1", {
      ...baseEvent,
      location: null,
    });
    expect(got).not.toBeNull();
    expect(got!.source).toBe("name");
  });
});
