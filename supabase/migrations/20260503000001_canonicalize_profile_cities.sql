-- One-time backfill: canonicalize existing profile cities so that the
-- write-side canonicalization shipped in this PR (onboarding, settings,
-- event-inquiry submit) doesn't strand existing rows in their pre-
-- canonical form ("St. Louis", "ST. LOUIS", etc.).
--
-- The canonical form (per src/lib/city-normalize.ts) is:
--   - Abbreviation expansion: "St"/"St." → "Saint", "Mt"/"Mt." → "Mount",
--     "Ft"/"Ft." → "Fort", "Pt"/"Pt." → "Point", and the directionals
--     N/S/E/W → "North"/"South"/"East"/"West" when followed by whitespace.
--   - Title-casing applied last so casing variants converge.
--
-- Postgres POSIX regex doesn't support JS-style lookaheads, so we use
-- start-of-word (\m) plus a captured trailing-whitespace-or-end-of-
-- string group (\s|$) and replace with the expansion + the captured
-- trailing context. \m anchors the abbreviation as a whole word so
-- "Sturgis" / "Mtraining" / etc. are not touched.
--
-- Idempotent: re-running on the same row produces the same output
-- because canonical strings ("Saint Louis") have no abbreviation
-- forms left to expand and initcap is stable on already-titlecased
-- input.

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
                    '\mSt\.?(\s|$)',  'Saint\1', 'gi'
                  ),
                  '\mMt\.?(\s|$)',    'Mount\1', 'gi'
                ),
                '\mFt\.?(\s|$)',      'Fort\1',  'gi'
              ),
              '\mPt\.?(\s|$)',        'Point\1', 'gi'
            ),
            '\mN\.?(\s)',             'North\1', 'gi'
          ),
          '\mS\.?(\s)',               'South\1', 'gi'
        ),
        '\mE\.?(\s)',                 'East\1',  'gi'
      ),
      '\mW\.?(\s)',                   'West\1',  'gi'
    ),
    '\s+',                            ' ',       'g'
  )
)
WHERE city IS NOT NULL
  AND btrim(city) <> '';

COMMIT;
