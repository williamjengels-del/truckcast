import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { parseToastEmail } from "./toast";

const YEAR = new Date().getFullYear();

describe("parseToastEmail", () => {
  it("parses standard subject + sales on same line", () => {
    const raw = `Subject: Wok-O Taco - Saturday, April 5, 2025
Total Net Sales  $1,234.56`;
    const result = parseToastEmail(raw);
    expect(result.date).toBe("2025-04-05");
    expect(result.netSales).toBe(1234.56);
  });

  it("parses Net sales with value on next line (Toast performance summary format)", () => {
    const raw = `Subject: Wok-O Taco - Friday, April 3
Net sales
$1,092.88`;
    const result = parseToastEmail(raw);
    expect(result.date).toBe(`${YEAR}-04-03`);
    expect(result.netSales).toBe(1092.88);
  });

  it("handles Fwd: prefix in subject", () => {
    const raw = `Fwd: Wok-O Taco - Friday, April 3
Net sales
$500.00`;
    const result = parseToastEmail(raw);
    expect(result.date).toBe(`${YEAR}-04-03`);
    expect(result.netSales).toBe(500.0);
  });

  it("defaults year to current year when omitted", () => {
    const raw = `Wok-O Taco - Monday, March 10
Net Sales: $200.00`;
    const result = parseToastEmail(raw);
    expect(result.date).toBe(`${YEAR}-03-10`);
  });

  it("parses sales with comma-formatted numbers", () => {
    const raw = `Wok-O Taco - Saturday, April 5, 2025
Total Net Sales $10,234.56`;
    const result = parseToastEmail(raw);
    expect(result.netSales).toBe(10234.56);
  });

  it("throws when no date found", () => {
    expect(() => parseToastEmail("No date here\nNet Sales $100.00")).toThrow();
  });

  it("throws when no sales found", () => {
    expect(() =>
      parseToastEmail("Wok-O Taco - Saturday, April 5, 2025\nNo sales data")
    ).toThrow();
  });
});

describe("parseToastEmail — pos-11 (regex greedy commas)", () => {
  it("rejects malformed comma placement '$1,2345.67' (was 10x off pre-fix)", () => {
    // Pre-fix the [\d,]+ regex stripped commas without validation,
    // turning "$1,2345.67" into 12345.67 silently — operator's
    // forecast denominators would be off by 10x, no signal in UI.
    expect(() =>
      parseToastEmail(
        `Wok-O Taco - Saturday, April 5, 2025\nTotal Net Sales $1,2345.67`
      )
    ).toThrow(/Could not find/);
  });

  it("accepts million-scale properly (1,234,567.89)", () => {
    const result = parseToastEmail(
      `Wok-O Taco - Saturday, April 5, 2025\nNet Sales $1,234,567.89`
    );
    expect(result.netSales).toBe(1234567.89);
  });

  it("accepts no-comma values", () => {
    const result = parseToastEmail(
      `Wok-O Taco - Saturday, April 5, 2025\nNet Sales $987.65`
    );
    expect(result.netSales).toBe(987.65);
  });
});

describe("parseToastEmail — pos-9 (year fallback for missing year)", () => {
  // Freeze time at 2026-05-09 so the prior-year heuristic is testable
  // independent of wall-clock.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("uses current year when subject month/day is in the past", () => {
    // April 5 < May 9 → 2026-04-05 is in the past, accept current year.
    const result = parseToastEmail(
      `Wok-O Taco - Sunday, April 5\nNet Sales $100.00`
    );
    expect(result.date).toBe("2026-04-05");
  });

  it("rolls back to prior year when subject date would be in the future", () => {
    // August 1 > May 9 → 2026-08-01 would be future. Toast sends
    // end-of-day emails so it's almost certainly last year's email
    // being reprocessed; drop to 2025-08-01.
    const result = parseToastEmail(
      `Wok-O Taco - Friday, August 1\nNet Sales $100.00`
    );
    expect(result.date).toBe("2025-08-01");
  });

  it("explicit year always wins (no rollback even if future)", () => {
    // Trust operator-supplied years — they may be back-importing or
    // testing with future dates.
    const result = parseToastEmail(
      `Wok-O Taco - Friday, August 1, 2027\nNet Sales $100.00`
    );
    expect(result.date).toBe("2027-08-01");
  });
});
