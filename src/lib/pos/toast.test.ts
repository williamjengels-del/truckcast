import { describe, it, expect } from "vitest";
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
