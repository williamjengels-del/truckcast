/**
 * Public slug validation + normalization.
 *
 * Slugs appear at `vendcast.co/<slug>` for public vendor profiles (v11
 * queue). The DB enforces lexical shape + uniqueness (migration
 * 20260424000003); this module enforces the route-reservation rules
 * the DB doesn't know about plus provides a normalization path for
 * suggesting slugs from business names.
 *
 * Keep the reserved list in sync with `src/app/` route directories.
 * When a new top-level route ships (e.g. `/pricing`), add it here so
 * an operator can't claim a slug that shadows it.
 */

const RESERVED_SLUGS = new Set<string>([
  // Auth + account
  "login",
  "logout",
  "signup",
  "auth",
  "account",
  "profile",
  "settings",
  // App surfaces
  "dashboard",
  "admin",
  "api",
  "app",
  "book",
  "booking",
  "contact",
  "embed",
  "follow",
  "help",
  "inbox",
  "insights",
  "integrations",
  "onboarding",
  "pricing",
  "roadmap",
  "schedule",
  "team",
  "terms",
  "tools",
  "privacy",
  // Marketing / SEO potentials
  "about",
  "blog",
  "docs",
  "faq",
  "home",
  "landing",
  "press",
  "status",
  "support",
  // Operational / safety
  "_next",
  "static",
  "public",
  "vendcast",
  "truckcast",
]);

export const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

export type SlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/**
 * Validate a proposed slug. Does not check DB uniqueness (that's the
 * caller's job — depends on whether you're creating or updating).
 */
export function validateSlug(raw: string | null | undefined): SlugValidationResult {
  if (!raw) return { ok: false, reason: "Slug is required" };
  const slug = raw.trim().toLowerCase();
  if (slug.length < SLUG_MIN_LENGTH) {
    return { ok: false, reason: `Slug must be at least ${SLUG_MIN_LENGTH} characters` };
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, reason: `Slug must be at most ${SLUG_MAX_LENGTH} characters` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason:
        "Slug must start with a letter and contain only lowercase letters, numbers, and single hyphens",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: `"${slug}" is reserved` };
  }
  return { ok: true, slug };
}

/**
 * Normalize an arbitrary business name into a slug candidate.
 * Returns null if the normalized result fails validation.
 *
 * Examples:
 *   "Wok-O Taco"           → "wok-o-taco"
 *   "Joe's BBQ & Grill"    → "joes-bbq-grill"
 *   "  Café du Monde  "    → "cafe-du-monde"   (strips diacritics)
 */
export function suggestSlugFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .trim()
    // Drop apostrophes (straight + curly) rather than hyphenating them —
    // "Joe's BBQ" should become "joes-bbq", not "joe-s-bbq".
    .replace(/['\u2019]/g, "");
  // Replace any remaining run of non-[a-z0-9] with a single hyphen.
  const hyphenated = stripped.replace(/[^a-z0-9]+/g, "-");
  // Trim leading/trailing hyphens.
  const trimmed = hyphenated.replace(/^-+|-+$/g, "");
  if (!trimmed) return null;
  // Truncate to max length (respecting validator ceiling).
  const truncated = trimmed.slice(0, SLUG_MAX_LENGTH);
  const result = validateSlug(truncated);
  return result.ok ? result.slug : null;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
