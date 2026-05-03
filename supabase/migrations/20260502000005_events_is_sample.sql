-- Sample data mode for new operators (per v33 brief suggestion #1).
--
-- Adds events.is_sample — a boolean flag that distinguishes seeded
-- "what does VendCast look like with data?" rows from real operator
-- bookings. Default false so all existing rows are correctly real.
--
-- The seeding flow lives in /api/sample-data/seed (server action). The
-- clear-sample flow lives in /api/sample-data/clear. Both scope to
-- auth.uid() = user_id via existing RLS policies on events.
--
-- Why a column rather than a separate table: sample data needs to
-- exercise the SAME read paths as real data (forecast engine, hero
-- chart, key takeaways, etc.). A separate table would mean either
-- code branches everywhere ("if sample mode use this") or a UNION
-- view that's hard to maintain. A boolean column on events is the
-- minimum-friction option — all existing aggregation just works,
-- and operators can clear sample data with a single DELETE WHERE
-- is_sample = true.
--
-- Schema discipline: additive nullable-defaulted boolean. No data
-- migration. No locks.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

-- Partial index for fast "find sample rows for this user" queries
-- (used by the clear-sample endpoint). Tiny — only sample rows count
-- against this index, which is the entire point.
CREATE INDEX IF NOT EXISTS idx_events_user_sample
  ON events (user_id)
  WHERE is_sample = true;

COMMENT ON COLUMN events.is_sample IS
  'True for events seeded by the new-user "see VendCast with data" button. Default false. Cleared via /api/sample-data/clear (DELETE WHERE is_sample=true). Existing aggregations + RLS policies treat sample rows identically to real rows by design — sample mode is an experience preview, not a code branch.';
