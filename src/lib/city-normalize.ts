// City + state name normalization.
//
// Abbreviation expansion, capitalization normalization (with apostrophe
// preservation), state suffix extraction. Deterministic — dictionary +
// regex. Fuzzy typo detection is explicitly OUT OF SCOPE for this module.
//
// Why canonicalize at save time:
//   Two operators (or the same operator twice) typing "St. Louis" and
//   "Saint Louis" would produce two distinct rows for the same place.
//   Platform blend, venue familiarity matching, and cross-user
//   aggregation all break under that drift. Storing the canonical
//   form at write time means every downstream comparison is a plain
//   equality check — no normalization-at-read-time footgun.
//
// Why abbreviation dictionary only, not fuzzy matching:
//   Fuzzy matching without a reference list can't tell "Chiicago"
//   (typo for Chicago) from "Chiacopa" (real but obscure). Silent
//   "auto-correct" of the latter into the former is the kind of
//   quiet data corruption that takes months to find. Abbreviation
//   expansion is deterministic — "St." is ALWAYS "Saint" — so the
//   rewrite rule is safe.
//
// Canonical form examples:
//   "St. Louis"          → "Saint Louis"
//   "St Louis"           → "Saint Louis"
//   "St.Louis"           → "Saint Louis" (period-attached, no space)
//   "saint louis"        → "Saint Louis" (title-case side effect)
//   "O'Fallon"           → "O'Fallon" (apostrophe capitalization preserved)
//   "o'fallon"           → "O'Fallon" (re-cased correctly across apostrophe)
//   "Mt. Pleasant"       → "Mount Pleasant"
//   "Saint Louis Mo"     → "Saint Louis" + state="MO" (suffix extracted)
//   "Saint Louis, MO"    → "Saint Louis" + state="MO"
//   "Saint Louis Missouri" → "Saint Louis" + state="MO"
//   ""                   → "" (empty stays empty)
//
// The weather pipeline's geocoding helper currently reverses part of
// this (Saint → St for Open-Meteo's index). That stays in
// normalizeCityForGeocoding(); this module is upstream of that.

import { US_STATES, US_STATE_NAMES, OTHER_STATE } from "./constants";

// Regex note: pattern shape is `\b<abbr>\b\.?` (with a trailing-context
// lookahead for the directionals). `\b` anchors the abbreviation as a
// whole word so "St" in "Station" / "Sturgis" / "Newark" / "Salinas"
// is never touched. `\.?` optionally consumes a trailing period.
//
// Replacement strings end with a trailing space so the period-attached
// form ("St.Louis" / "Mt.Pleasant" / "N.Bend") expands cleanly without
// gluing the next word on. Double spaces collapse in the whitespace
// pass at the end of canonicalizeCity().
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bSt\b\.?/gi, "Saint "],
  [/\bMt\b\.?/gi, "Mount "],
  [/\bFt\b\.?/gi, "Fort "],
  [/\bPt\b\.?/gi, "Point "],
  [/\bN\b\.?(?=\s|[A-Za-z])/gi, "North "],
  [/\bS\b\.?(?=\s|[A-Za-z])/gi, "South "],
  [/\bE\b\.?(?=\s|[A-Za-z])/gi, "East "],
  [/\bW\b\.?(?=\s|[A-Za-z])/gi, "West "],
];

/**
 * Title-case a string while preserving capitalization across non-letter
 * boundaries (apostrophes, hyphens, whitespace). Splits on those
 * separators, capitalizes the first letter of each letter-segment, and
 * lower-cases the rest.
 *
 * Apostrophe behavior is the load-bearing fix here. Pre-2026-05-07 the
 * function split only on whitespace + dash, so "O'Fallon" was treated as
 * a single segment and mapped to "O'fallon" (the F got lower-cased
 * because it sat inside slice(1).toLowerCase()). Splitting on apostrophe
 * too means "O'Fallon" → ["O", "'", "Fallon"] → each letter-segment
 * capitalizes correctly.
 */
function titleCase(s: string): string {
  return s
    .split(/(\s+|[-'])/)
    .map((seg) => {
      if (!seg) return seg;
      // Whitespace, dash, or apostrophe — pass through untouched.
      if (/^\s+$/.test(seg) || seg === "-" || seg === "'") return seg;
      // Skip segments that don't start with a letter (numbers, punctuation).
      if (!/^[A-Za-z]/.test(seg)) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    })
    .join("");
}

/**
 * Normalize a state input to the 2-letter US code.
 *
 * Accepts:
 *   - 2-letter codes in any case: "MO" / "mo" / "Mo" → "MO"
 *   - Full state names in any case: "Missouri" / "missouri" / "MISSOURI" → "MO"
 *   - The "OTHER" sentinel (out-of-US events): pass-through
 *
 * Returns null for unrecognized input. Callers should treat null as
 * "couldn't normalize" — show through to the operator rather than
 * silently writing a wrong value.
 */
export function normalizeStateCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper === OTHER_STATE) return OTHER_STATE;
  if (US_STATES.includes(upper)) return upper;
  // Reverse lookup full name → code (case-insensitive).
  const lower = trimmed.toLowerCase();
  for (const [code, name] of Object.entries(US_STATE_NAMES)) {
    if (name.toLowerCase() === lower) return code;
  }
  return null;
}

/**
 * Build a regex that matches a trailing state suffix on a city string.
 * Matches:
 *   - ", MO" / ", Missouri" / ", mo" (any case)
 *   - " MO" / " Missouri" / " mo" (any case, no comma)
 * Optionally consumes a trailing zip code after the state.
 */
function buildStateSuffixPattern(): RegExp {
  // Build alternation of all state codes + full names (case-insensitive
  // via the i flag below). We deliberately match against the canonical
  // names; case folding is handled by the regex flag.
  const codes = US_STATES.join("|");
  const names = Object.values(US_STATE_NAMES)
    .map((n) => n.replace(/\s/g, "\\s+")) // "New York" → "New\s+York"
    .join("|");
  // Pattern: comma-or-space, the state code or name, optional whitespace
  // and a 5-digit zip, anchored to end of string.
  return new RegExp(
    `[,\\s]+(?:${codes}|${names})\\b(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*$`,
    "i"
  );
}

const STATE_SUFFIX_PATTERN = buildStateSuffixPattern();

/**
 * Extract a trailing state suffix from a city string.
 *
 * Examples:
 *   "Saint Louis Mo"        → { city: "Saint Louis", state: "MO" }
 *   "Saint Louis, MO"       → { city: "Saint Louis", state: "MO" }
 *   "Saint Louis Missouri"  → { city: "Saint Louis", state: "MO" }
 *   "Saint Louis Mo 63101"  → { city: "Saint Louis", state: "MO" }  (zip stripped)
 *   "Saint Louis"           → { city: "Saint Louis", state: null }
 *   "Chicago Il"            → { city: "Chicago", state: "IL" }
 *
 * Designed to run after canonicalizeCity has already normalized the
 * abbreviations and casing, but is robust to running before too.
 */
export function extractStateFromCity(raw: string): { city: string; state: string | null } {
  if (!raw) return { city: "", state: null };
  const trimmed = raw.trim();
  const match = trimmed.match(STATE_SUFFIX_PATTERN);
  if (!match) return { city: trimmed, state: null };
  const suffix = match[0];
  // The suffix includes the leading separator. Pull out just the state
  // portion (codes are 2 chars; full names vary). Re-extract via a
  // simpler regex against the matched suffix.
  const stateMatch = suffix.match(/(?:[,\s]+)([A-Za-z]{2,}(?:\s+[A-Za-z]+)?)/);
  const stateRaw = stateMatch ? stateMatch[1].trim().replace(/\s+\d{5}.*$/, "") : "";
  // Strip any trailing zip from stateRaw before normalizing.
  const stateClean = stateRaw.replace(/\s+\d.*$/, "").trim();
  const state = normalizeStateCode(stateClean);
  if (!state) return { city: trimmed, state: null };
  const city = trimmed.slice(0, trimmed.length - suffix.length).trim();
  return { city, state };
}

/**
 * Expand abbreviations and normalize casing. Stable output for the
 * same input; apply at save time to canonicalize the stored value.
 *
 * Returns empty string unchanged. Trims surrounding whitespace.
 *
 * Note: this function does NOT strip state suffixes — that's the
 * responsibility of `extractStateFromCity` (run before canonicalize)
 * or callers that want to populate both city and state columns from a
 * combined input. Splitting the responsibilities means callers that
 * just want casing normalization don't accidentally lose suffix
 * content they wanted to keep.
 */
export function canonicalizeCity(raw: string | null | undefined): string {
  if (!raw) return "";
  let out = raw.trim();
  if (!out) return "";
  for (const [pattern, replacement] of ABBREVIATIONS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse internal multiple spaces + apply title case.
  out = out.replace(/\s+/g, " ").trim();
  out = titleCase(out);
  return out;
}

/**
 * Combined helper: canonicalize a city string AND extract any state
 * suffix. Use at the event-save path so "Saint Louis Mo" goes to
 * city="Saint Louis", state="MO" without the operator having to type
 * them separately. If the operator already provided a state explicitly,
 * the explicit value takes precedence over the extracted suffix.
 */
export function canonicalizeCityAndState(
  rawCity: string | null | undefined,
  rawState?: string | null | undefined
): { city: string; state: string | null } {
  if (!rawCity) {
    return { city: "", state: normalizeStateCode(rawState ?? null) };
  }
  const explicit = normalizeStateCode(rawState ?? null);
  // Extract first so we don't run the suffix pattern against an
  // already-normalized string (which would still match but is
  // wasted work).
  const extracted = extractStateFromCity(rawCity);
  const city = canonicalizeCity(extracted.city);
  // Operator-provided state wins; extracted state is the fallback.
  const state = explicit ?? extracted.state;
  return { city, state };
}
