import { describe, it, expect } from "vitest";
import {
  generateRecoveryCodes,
  formatRecoveryCode,
  normalizeRecoveryCode,
  hashRecoveryCode,
  isWellFormedRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "./recovery-codes";

describe("generateRecoveryCodes", () => {
  it("returns the requested count of codes by default 8", () => {
    expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it("each code is 10 chars from the unambiguous alphabet", () => {
    const codes = generateRecoveryCodes(20);
    const allowed = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
    for (const code of codes) {
      expect(code).toMatch(allowed);
    }
  });

  it("codes are unique within a single batch (collision check)", () => {
    const codes = generateRecoveryCodes(50);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("formatRecoveryCode + normalizeRecoveryCode", () => {
  it("inserts a hyphen at position 5 for display", () => {
    expect(formatRecoveryCode("ABCDE23456")).toBe("ABCDE-23456");
  });

  it("normalize strips hyphens and whitespace, uppercases", () => {
    expect(normalizeRecoveryCode("abcde-23456")).toBe("ABCDE23456");
    expect(normalizeRecoveryCode("  abc de-2 3456 ")).toBe("ABCDE23456");
  });

  it("hyphenated and non-hyphenated forms hash identically", () => {
    expect(hashRecoveryCode("ABCDE-23456")).toBe(hashRecoveryCode("ABCDE23456"));
    expect(hashRecoveryCode("abcde 23456")).toBe(hashRecoveryCode("ABCDE-23456"));
  });
});

describe("hashRecoveryCode", () => {
  it("is deterministic", () => {
    expect(hashRecoveryCode("ABCDE23456")).toBe(hashRecoveryCode("ABCDE23456"));
  });

  it("differs for different inputs", () => {
    expect(hashRecoveryCode("ABCDE23456")).not.toBe(
      hashRecoveryCode("ABCDE23457")
    );
  });

  it("returns a 64-char hex string", () => {
    expect(hashRecoveryCode("ABCDE23456")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isWellFormedRecoveryCode", () => {
  it("accepts valid codes (with or without hyphen / casing)", () => {
    expect(isWellFormedRecoveryCode("ABCDE23456")).toBe(true);
    expect(isWellFormedRecoveryCode("abcde-23456")).toBe(true);
    expect(isWellFormedRecoveryCode("  ABCDE-23456  ")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isWellFormedRecoveryCode("ABCDE2345")).toBe(false);
    expect(isWellFormedRecoveryCode("ABCDE234567")).toBe(false);
    expect(isWellFormedRecoveryCode("")).toBe(false);
  });

  it("rejects ambiguous characters that aren't in the alphabet", () => {
    // 0, O, 1, I, L are deliberately excluded.
    expect(isWellFormedRecoveryCode("0BCDE23456")).toBe(false);
    expect(isWellFormedRecoveryCode("OBCDE23456")).toBe(false);
    expect(isWellFormedRecoveryCode("1BCDE23456")).toBe(false);
    expect(isWellFormedRecoveryCode("IBCDE23456")).toBe(false);
    expect(isWellFormedRecoveryCode("LBCDE23456")).toBe(false);
  });

  it("rejects non-alphanumeric garbage", () => {
    expect(isWellFormedRecoveryCode("ABCDE 2345!")).toBe(false);
  });
});
