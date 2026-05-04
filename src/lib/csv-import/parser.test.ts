import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCSV, parseTimeRange, normalizeTime, parseDate } from "./parser";

describe("parseCSV", () => {
  it("preserves embedded newlines inside quoted fields", () => {
    const fixturePath = path.resolve(
      __dirname,
      "../../../tests/fixtures/quoted-newlines.csv"
    );
    const text = readFileSync(fixturePath, "utf8");
    const { headers, rows } = parseCSV(text);

    expect(headers).toEqual(["event_name", "event_date", "notes", "net_sales"]);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toEqual([
      "Taste of St. Louis",
      "2024-09-14",
      "Line one\nLine two\nLine three",
      "3200",
    ]);
    expect(rows[1]).toEqual([
      "Downtown Farmers Market",
      "2024-08-03",
      "Single line note",
      "1450",
    ]);
    expect(rows[2]).toEqual([
      "Soulard Fest",
      "2024-10-05",
      'Multi-line with "quoted" words\nand a second line',
      "2100",
    ]);
  });

  it("handles CRLF line terminators", () => {
    const text =
      'a,b,c\r\n"1","2","3"\r\n"x","y","z"\r\n';
    const { headers, rows } = parseCSV(text);
    expect(headers).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["x", "y", "z"],
    ]);
  });

  it("preserves CRLF embedded inside a quoted field", () => {
    const text = 'name,notes\r\n"A","line1\r\nline2"\r\n';
    const { rows } = parseCSV(text);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("line1\r\nline2");
  });
});

describe("normalizeTime", () => {
  it("accepts bare hour with AM/PM ('5pm')", () => {
    expect(normalizeTime("5pm")).toBe("17:00");
    expect(normalizeTime("5 PM")).toBe("17:00");
    expect(normalizeTime("11am")).toBe("11:00");
    expect(normalizeTime("12am")).toBe("00:00");
    expect(normalizeTime("12pm")).toBe("12:00");
  });
  it("still accepts H:MM with AM/PM", () => {
    expect(normalizeTime("5:30 PM")).toBe("17:30");
  });
  it("still accepts 24h", () => {
    expect(normalizeTime("17:00")).toBe("17:00");
  });
  it("rejects out-of-range AM/PM hours", () => {
    // Hour must be 1-12 on a 12-hour clock — '13 PM' / '13:00 PM' /
    // '0 AM' are nonsense and should return null instead of producing
    // a garbage 13:00.
    expect(normalizeTime("13 PM")).toBe(null);
    expect(normalizeTime("13:00 PM")).toBe(null);
    expect(normalizeTime("0 AM")).toBe(null);
  });
});

describe("parseDate", () => {
  it("ISO 4-digit", () => {
    expect(parseDate("2024-09-14")).toBe("2024-09-14");
  });
  it("US slash 4-digit year", () => {
    expect(parseDate("9/14/2024")).toBe("2024-09-14");
  });
  it("US slash 2-digit year (20xx / 19xx pivot at 50)", () => {
    expect(parseDate("9/14/24")).toBe("2024-09-14");
    expect(parseDate("9/14/95")).toBe("1995-09-14");
  });
  it("rejects European DD/MM/YYYY rather than mismangling it", () => {
    // 14 isn't a valid month — return null so the caller can flag it
    // instead of producing 'YYYY-14-09'.
    expect(parseDate("14/09/2024")).toBe(null);
  });
  it("rejects out-of-range day", () => {
    expect(parseDate("2/35/2024")).toBe(null);
  });
  it("falls through to JS Date for long formats", () => {
    expect(parseDate("September 14, 2024")).toBe("2024-09-14");
  });
  it("returns null for empty + garbage", () => {
    expect(parseDate("")).toBe(null);
    expect(parseDate("tomorrow")).toBe(null);
  });
});

describe("parseTimeRange", () => {
  it("ascii hyphen with explicit AM/PM on both sides", () => {
    expect(parseTimeRange("5:00 PM - 9:00 PM")).toEqual({
      start: "17:00",
      end: "21:00",
    });
  });
  it("en-dash separator", () => {
    expect(parseTimeRange("5:00 PM – 9:00 PM")).toEqual({
      start: "17:00",
      end: "21:00",
    });
  });
  it("em-dash separator", () => {
    expect(parseTimeRange("5:00 PM — 9:00 PM")).toEqual({
      start: "17:00",
      end: "21:00",
    });
  });
  it("'to' as separator (case-insensitive)", () => {
    expect(parseTimeRange("11am to 3pm")).toEqual({
      start: "11:00",
      end: "15:00",
    });
    expect(parseTimeRange("11am TO 3pm")).toEqual({
      start: "11:00",
      end: "15:00",
    });
  });
  it("bare hour + meridiem on both sides", () => {
    expect(parseTimeRange("5pm-9pm")).toEqual({
      start: "17:00",
      end: "21:00",
    });
  });
  it("24h range with no meridiem", () => {
    expect(parseTimeRange("17:00-21:00")).toEqual({
      start: "17:00",
      end: "21:00",
    });
  });
  it("inherits meridiem when only one side has it ('5–9 PM')", () => {
    expect(parseTimeRange("5–9 PM")).toEqual({
      start: "17:00",
      end: "21:00",
    });
    expect(parseTimeRange("11–3 PM")).toEqual({
      start: "11:00",
      end: "15:00",
    });
  });
  it("returns null/null on garbage", () => {
    expect(parseTimeRange("nonsense")).toEqual({ start: null, end: null });
    expect(parseTimeRange("")).toEqual({ start: null, end: null });
  });
  it("returns null/null when separator is missing", () => {
    expect(parseTimeRange("5pm")).toEqual({ start: null, end: null });
  });
});
