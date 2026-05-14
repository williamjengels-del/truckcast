/**
 * Tests for the email unsubscribe token primitives.
 *
 * Scope is the pure HMAC sign/verify layer. The /unsubscribe page and
 * /api/email/unsubscribe route compose these with Supabase service
 * role + URL parsing; those are tested via the deployed surface.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from "./unsubscribe-token";

const TEST_SECRET = "a".repeat(64); // 512 bits, deterministic
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

beforeAll(() => {
  process.env.UNSUBSCRIBE_TOKEN_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
});

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  it("signs and verifies a token round-trip", () => {
    const token = signUnsubscribeToken(USER_A);
    expect(verifyUnsubscribeToken(USER_A, token)).toBe(true);
  });

  it("returns hex-encoded 64-char (256-bit) HMAC", () => {
    const token = signUnsubscribeToken(USER_A);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces stable output across calls (deterministic)", () => {
    expect(signUnsubscribeToken(USER_A)).toBe(signUnsubscribeToken(USER_A));
  });

  it("rejects a token signed for a different user", () => {
    const tokenForA = signUnsubscribeToken(USER_A);
    expect(verifyUnsubscribeToken(USER_B, tokenForA)).toBe(false);
  });

  it("rejects a tampered token (one-character flip)", () => {
    const token = signUnsubscribeToken(USER_A);
    const tampered =
      token.slice(0, -1) + (token.slice(-1) === "0" ? "1" : "0");
    expect(verifyUnsubscribeToken(USER_A, tampered)).toBe(false);
  });

  it("rejects empty / missing token", () => {
    expect(verifyUnsubscribeToken(USER_A, "")).toBe(false);
    expect(verifyUnsubscribeToken(USER_A, null)).toBe(false);
    expect(verifyUnsubscribeToken(USER_A, undefined)).toBe(false);
  });

  it("rejects empty / missing userId", () => {
    const token = signUnsubscribeToken(USER_A);
    expect(verifyUnsubscribeToken("", token)).toBe(false);
  });

  it("rejects non-hex garbage without throwing", () => {
    expect(verifyUnsubscribeToken(USER_A, "not-hex-!!")).toBe(false);
    expect(verifyUnsubscribeToken(USER_A, "z".repeat(64))).toBe(false);
  });

  it("rejects token of wrong length without throwing", () => {
    expect(verifyUnsubscribeToken(USER_A, "abc")).toBe(false);
    expect(verifyUnsubscribeToken(USER_A, "ab".repeat(40))).toBe(false);
  });
});

describe("verify when secret is missing", () => {
  it("returns false instead of throwing when secret env is absent", () => {
    const saved = process.env.UNSUBSCRIBE_TOKEN_SECRET;
    delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    try {
      // verify catches the secret-missing throw and returns false —
      // a malformed link should never crash the request.
      expect(verifyUnsubscribeToken(USER_A, "a".repeat(64))).toBe(false);
    } finally {
      process.env.UNSUBSCRIBE_TOKEN_SECRET = saved;
    }
  });
});

describe("buildUnsubscribeUrl", () => {
  it("composes a URL with u and t query params", () => {
    const url = buildUnsubscribeUrl(USER_A);
    expect(url).toContain("https://vendcast.co/unsubscribe?u=");
    expect(url).toContain(USER_A);
    expect(url).toContain("&t=");
    // token portion should be 64 hex chars after &t=
    const tokenPart = url.split("&t=")[1];
    expect(tokenPart).toMatch(/^[0-9a-f]{64}$/);
  });

  it("respects a custom base URL (preview / staging)", () => {
    const url = buildUnsubscribeUrl(USER_A, "https://preview.vendcast.co");
    expect(url.startsWith("https://preview.vendcast.co/unsubscribe?")).toBe(
      true
    );
  });

  it("produces a token that round-trips through verify", () => {
    const url = buildUnsubscribeUrl(USER_A);
    const tokenPart = url.split("&t=")[1];
    expect(verifyUnsubscribeToken(USER_A, tokenPart)).toBe(true);
  });
});
