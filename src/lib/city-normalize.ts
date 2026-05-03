// City name normalization.
//
// Abbreviation expansion only — deterministic, dictionary + regex.
// Fuzzy typo detection is explicitly OUT OF SCOPE for this module.
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
//   "St. Louis"      → "Saint Louis"
//   "St Louis"       → "Saint Louis"
//   "St.Louis"       → "Saint Louis" (period-attached, no space)
//   "saint louis"    → "Saint Louis" (title-case side effect; see below)
//   "Mt. Pleasant"   → "Mount Pleasant"
//   "Ft. Collins"    → "Fort Collins"
//   "Pt. Reyes"      → "Point Reyes"
//   "N. Bend"        → "North Bend"
//   "N.Bend"         → "North Bend" (period-attached, no space)
//   "W. Palm Beach"  → "West Palm Beach"
//   "New York City"  → "New York City" (unchanged, no abbreviations)
//   ""               → "" (empty stays empty)
//
// Title-casing is applied at the end to normalize casing noise
// ("ST. LOUIS" and "st. louis" both land at "Saint Louis").
//
// The weather pipeline's geocoding helper currently reverses part of
// this (Saint → St for Open-Meteo's index). That stays in
// normalizeCityForGeocoding(); this module is upstream of that.

// Regex note: pattern shape is `\b<abbr>\b\.?` (with a trailing-context
// lookahead for the directionals). `\b` anchors the abbreviation as a
// whole word so "St" in "Station" / "Sturgis" / "Newark" / "Salinas"
// is never touched. `\.?` optionally consumes a trailing period.
//
// Replacement strings end with a trailing space so the period-attached
// form ("St.Louis" / "Mt.Pleasant" / "N.Bend") expands cleanly without
// gluing the next word on. Double spaces from cases like "St. Louis"
// collapse in the whitespace pass at the end of canonicalizeCity().
//
// For multi-letter abbreviations (St/Mt/Ft/Pt) the word boundary alone
// is enough because the abbreviation can't start a real city name on
// its own. "St" / "St." / "St.Marys" / "St Louis" all fold to the same
// canonical form.
//
// For single-letter directionals (N/S/E/W) the word boundary isn't
// enough — a bare "N" at the end of an input string is too ambiguous
// to expand. The lookahead requires whitespace OR a letter so we still
// catch "N.Bend" (period then letter) without converting standalone
// "N" / "N." into "North" against the user's intent.
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

function titleCase(s: string): string {
  return s
    .split(/(\s+|-)/)
    .map((seg) =>
      /^\s+$/.test(seg) || seg === "-"
        ? seg
        : seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()
    )
    .join("");
}

/**
 * Expand abbreviations and normalize casing. Stable output for the
 * same input; apply at save time to canonicalize the stored value.
 *
 * Returns empty string unchanged. Trims surrounding whitespace.
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
