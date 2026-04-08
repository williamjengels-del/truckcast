/**
 * Additional edge-case tests for Toast email parser.
 * Supplements the main toast.test.ts.
 */

import { describe, it, expect } from "vitest";
import { parseToastEmail } from "./toast";

describe("parseToastEmail — edge cases", () => {
  it("handles 'Fwd: Fwd:' double-forward prefix", () => {
    const currentYear = new Date().getFullYear();
    const text = `Fwd: Fwd: Daily Summary - Wednesday, January 8
Net sales
$782.45`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(782.45);
    // Year-less dates default to current year
    expect(result.date).toBe(`${currentYear}-01-08`);
  });

  it("handles 'Re: Fwd:' mixed prefix", () => {
    const text = `Re: Fwd: Daily Summary - Thursday, March 6
Total Net sales $1,234.56`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(1234.56);
  });

  it("parses sales with no cents (whole dollar)", () => {
    const text = `Daily Summary - Monday, April 7, 2025
Net sales $500.00`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBe(500.00);
  });

  it("parses large sales with comma separator", () => {
    const text = `Daily Summary - Saturday, December 20, 2024
Net sales $12,345.67`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(12345.67);
  });

  it("handles 'Net Sales' with capital S", () => {
    const text = `Daily Summary - Friday, February 14
Net Sales $425.00`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(425.00);
  });

  it("handles 'total net sales' prefix variation", () => {
    const text = `Daily Summary - Tuesday, May 6
Total Net Sales $672.30`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(672.30);
  });

  it("next-line format: value on the line after label", () => {
    const text = `Daily Summary - Sunday, June 1, 2025
Net sales
$1,092.88`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(1092.88);
    expect(result.date).toBe("2025-06-01");
  });

  it("throws when no date found in email", () => {
    const text = `Net sales $500.00`;
    expect(() => parseToastEmail(text)).toThrow();
  });

  it("throws when no net sales value found", () => {
    const text = `Daily Summary - Monday, April 7, 2025
No sales data here`;
    expect(() => parseToastEmail(text)).toThrow();
  });

  it("prefers explicit sales line over header values", () => {
    // Multi-line email with a clear Net sales line
    const text = `Daily Summary - Wednesday, July 4
Gross sales $2,500.00
Discounts -$50.00
Net sales $2,450.00
Tax $180.00`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(2450.00);
  });

  it("parses date without year and defaults to current year", () => {
    const currentYear = new Date().getFullYear();
    const text = `Daily Summary - Thursday, August 15
Net sales $340.00`;
    const result = parseToastEmail(text);
    expect(result.date).toMatch(new RegExp(`^${currentYear}-08-15$`));
  });

  it("returns rawSubject that strips Fwd: prefix", () => {
    const text = `Fwd: Daily Summary - Monday, March 3
Net sales $280.00`;
    const result = parseToastEmail(text);
    expect(result.rawSubject).not.toMatch(/^Fwd:/i);
  });

  it("handles sales value of 0.01 (near-zero)", () => {
    const text = `Daily Summary - Tuesday, January 1
Net sales $0.01`;
    const result = parseToastEmail(text);
    expect(result.netSales).toBeCloseTo(0.01);
  });
});
