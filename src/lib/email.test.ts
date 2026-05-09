import { describe, it, expect } from "vitest";
import { safeSubjectFragment } from "./email";

describe("safeSubjectFragment (email-8)", () => {
  it("returns empty string for null / undefined / empty input", () => {
    expect(safeSubjectFragment(null)).toBe("");
    expect(safeSubjectFragment(undefined)).toBe("");
    expect(safeSubjectFragment("")).toBe("");
  });

  it("strips HTML tags but keeps inner text (subject is plain text — inner stays harmless)", () => {
    expect(safeSubjectFragment("<b>Wok-O</b> Taco")).toBe("Wok-O Taco");
    expect(safeSubjectFragment("Pre <script>alert(1)</script> Post")).toBe(
      "Pre alert(1) Post"
    );
  });

  it("normalizes CR/LF/tab to single space (header-injection defense)", () => {
    expect(safeSubjectFragment("Line1\nLine2")).toBe("Line1 Line2");
    expect(safeSubjectFragment("Tab\there\rthen\nline")).toBe("Tab here then line");
  });

  it("trims leading and trailing whitespace", () => {
    expect(safeSubjectFragment("  hello  ")).toBe("hello");
  });

  it("truncates to 120 characters", () => {
    const long = "a".repeat(200);
    expect(safeSubjectFragment(long)).toHaveLength(120);
  });

  it("does NOT HTML-escape (raw text in subject lines is correct)", () => {
    // Mail clients render subject as plain text — entity-escaping
    // would show literal "&amp;" in the inbox.
    expect(safeSubjectFragment("Stan & Jan")).toBe("Stan & Jan");
    expect(safeSubjectFragment(`Quote "test"`)).toBe(`Quote "test"`);
  });
});
