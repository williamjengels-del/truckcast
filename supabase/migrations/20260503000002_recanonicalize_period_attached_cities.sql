-- Follow-up to 20260503000001_canonicalize_profile_cities: that
-- backfill mirrored the JS canonicalizer's old rules and left rows
-- like "St.louis" (period-attached, no space before next word)
-- untouched because the original lookahead required whitespace or
-- end-of-string after the abbreviation.
--
-- This migration re-runs the canonicalization with the updated rules
-- shipped alongside it in src/lib/city-normalize.ts:
--   - Multi-letter abbreviations (St/Mt/Ft/Pt): match anywhere the
--     abbreviation is a whole word (`\m...\M`), with optional period.
--     Replacement adds a trailing space so "St.Marys" expands to
--     "Saint Marys" instead of gluing as "SaintMarys".
--   - Directional prefixes (N/S/E/W): match the same way but require
--     that the position after the optional period is whitespace or
--     a letter — so a bare "N" at the end of "Some Place N" is left
--     alone (too ambiguous to assume directional intent).
--
-- Idempotent: rows already in canonical form ("Saint Louis", "Toledo")
-- have no abbreviation pattern left to match and pass through
-- unchanged. The whitespace collapse and initcap are stable on
-- already-canonical input.
--
-- Postgres ARE flavor supports lookahead constraints `(?=...)`, used
-- in the directional patterns. \m / \M are word-start / word-end.

BEGIN;

UPDATE profiles
SET city = initcap(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    btrim(city),
                    '\mSt\M\.?',                       'Saint ',  'gi'
                  ),
                  '\mMt\M\.?',                         'Mount ',  'gi'
                ),
                '\mFt\M\.?',                           'Fort ',   'gi'
              ),
              '\mPt\M\.?',                             'Point ',  'gi'
            ),
            '\mN\M\.?(?=\s|[A-Za-z])',                 'North ',  'gi'
          ),
          '\mS\M\.?(?=\s|[A-Za-z])',                   'South ',  'gi'
        ),
        '\mE\M\.?(?=\s|[A-Za-z])',                     'East ',   'gi'
      ),
      '\mW\M\.?(?=\s|[A-Za-z])',                       'West ',   'gi'
    ),
    '\s+',                                             ' ',       'g'
  )
)
WHERE city IS NOT NULL
  AND btrim(city) <> '';

COMMIT;
