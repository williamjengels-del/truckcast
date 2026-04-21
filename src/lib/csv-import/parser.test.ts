import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCSV } from "./parser";

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
