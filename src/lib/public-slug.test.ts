import { describe, it, expect } from "vitest";
import {
  validateSlug,
  suggestSlugFromName,
  isReservedSlug,
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
} from "./public-slug";

describe("validateSlug", () => {
  it("accepts simple lowercase alphanumeric", () => {
    expect(validateSlug("wok-o-taco")).toEqual({ ok: true, slug: "wok-o-taco" });
  });

  it("trims + lowercases input before validating", () => {
    expect(validateSlug("  Wok-O-Taco  ")).toEqual({ ok: true, slug: "wok-o-taco" });
  });

  it("rejects empty / null / undefined", () => {
    expect(validateSlug("")).toEqual({ ok: false, reason: expect.any(String) });
    expect(validateSlug(null)).toEqual({ ok: false, reason: expect.any(String) });
    expect(validateSlug(undefined)).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects too-short slugs", () => {
    const r = validateSlug("ab");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(String(SLUG_MIN_LENGTH));
  });

  it("rejects too-long slugs", () => {
    const tooLong = "a".repeat(SLUG_MAX_LENGTH + 1);
    const r = validateSlug(tooLong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(String(SLUG_MAX_LENGTH));
  });

  it("rejects slugs starting with a digit or hyphen", () => {
    expect(validateSlug("1taco").ok).toBe(false);
    expect(validateSlug("-taco").ok).toBe(false);
  });

  it("rejects slugs ending in a hyphen", () => {
    expect(validateSlug("taco-").ok).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    expect(validateSlug("taco--truck").ok).toBe(false);
  });

  it("rejects uppercase or special chars", () => {
    expect(validateSlug("Wok_Taco").ok).toBe(false);
    expect(validateSlug("woktaco!").ok).toBe(false);
    expect(validateSlug("wok taco").ok).toBe(false);
  });

  it("rejects reserved slugs", () => {
    for (const reserved of ["admin", "api", "dashboard", "signup", "login"]) {
      const r = validateSlug(reserved);
      expect(r.ok, `"${reserved}" should be reserved`).toBe(false);
      if (!r.ok) expect(r.reason.toLowerCase()).toContain("reserved");
    }
  });
});

describe("suggestSlugFromName", () => {
  it("strips diacritics and lowercases", () => {
    expect(suggestSlugFromName("Café du Monde")).toBe("cafe-du-monde");
  });

  it("collapses special chars into hyphens", () => {
    expect(suggestSlugFromName("Joe's BBQ & Grill")).toBe("joes-bbq-grill");
  });

  it("handles a name that's already a valid slug", () => {
    expect(suggestSlugFromName("wok-o-taco")).toBe("wok-o-taco");
  });

  it("preserves internal hyphens, removes duplicates", () => {
    expect(suggestSlugFromName("Wok-O Taco")).toBe("wok-o-taco");
  });

  it("returns null for unusable input", () => {
    expect(suggestSlugFromName("")).toBeNull();
    expect(suggestSlugFromName("   ")).toBeNull();
    expect(suggestSlugFromName("!!!")).toBeNull();
    expect(suggestSlugFromName(null)).toBeNull();
  });

  it("truncates to max length and re-validates", () => {
    const longName = "a".repeat(100);
    const result = suggestSlugFromName(longName);
    expect(result).not.toBeNull();
    if (result) expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it("returns null if the suggestion would be reserved", () => {
    expect(suggestSlugFromName("admin")).toBeNull();
    expect(suggestSlugFromName("Dashboard!")).toBeNull();
  });
});

describe("isReservedSlug", () => {
  it("catches common app routes", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("dashboard")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("Api")).toBe(true);
  });

  it("returns false for arbitrary business-ish slugs", () => {
    expect(isReservedSlug("wok-o-taco")).toBe(false);
    expect(isReservedSlug("best-wurst")).toBe(false);
  });
});
