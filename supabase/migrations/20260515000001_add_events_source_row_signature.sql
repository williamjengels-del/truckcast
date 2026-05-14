-- events.source_row_signature + per-user uniqueness.
--
-- Driver: re-importing a CSV without dupActions silently inserts the
-- same rows again. The naive UNIQUE(user_id, event_name, event_date)
-- approach would break 7+ existing legitimate same-day pairs (a
-- Chesterfield Amphitheater Sat+Sun shift cluster, Best Wurst Jingle
-- 12/23/2024 with 5 rows, Frankie Martin's Garden 5/4 + 6/22 with
-- 5 rows each).
--
-- Real fix: per-CSV-row signature column. Manual entries get NULL
-- signature (never collide via this constraint). CSV-imported rows
-- carry a sha256-derived signature from the input row's content;
-- re-importing the SAME source row → constraint fires → operator
-- gets a clean "already imported" message instead of a silent dup.
--
-- Legitimate same-day pairs are unaffected because each is a
-- DIFFERENT CSV row content (different times / sales / notes /
-- locations), so their signatures differ even though
-- (event_name, event_date) match.
--
-- Signature input fields (see src/lib/csv-import/parser.ts
-- computeCsvRowSignature for the canonical hashing function):
--   event_name (normalized lowercase + trimmed)
--   event_date (YYYY-MM-DD)
--   net_sales (numeric or NULL marker)
--   location (normalized lowercase + trimmed)
--   city (normalized lowercase + trimmed)
--   state (uppercase or NULL marker)
--
-- Partial unique index: only enforces uniqueness when
-- source_row_signature is non-null. Manual entries (signature NULL)
-- are unaffected — they keep their existing duplicate-creation
-- ability when the operator deliberately enters two same-day same-
-- name events.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source_row_signature TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS events_user_csv_signature_unique
  ON events (user_id, source_row_signature)
  WHERE source_row_signature IS NOT NULL;
