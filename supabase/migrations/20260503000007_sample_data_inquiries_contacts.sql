-- Add is_sample marker to event_inquiries and contacts so the
-- existing /api/sample-data/seed + /api/sample-data/clear routes can
-- extend coverage past events without losing the clean teardown
-- guarantee. Pattern mirrors events.is_sample (added in
-- 20260502000005_events_is_sample.sql) — boolean default false, no
-- backfill needed since real rows simply default to false.
--
-- Why this matters: Phase 2.5 lower-feature-section screenshots use
-- a dedicated demo operator account. The screenshots show the
-- inquiries inbox + day-of-event card, so the seeder needs to
-- populate inquiries (3+ for the engagement-signal copy to fire) and
-- the contact for today's event. Without is_sample on those tables,
-- 'Clear sample data' would leave inquiries / contacts orphaned.

ALTER TABLE event_inquiries
  ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT false;
