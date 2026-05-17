-- Event-type taxonomy reclassification (2026-05-17) — STEP 1 of 2.
--
-- Adds the 6 new food-truck event_type values from the reclassification
-- proposal (Briefs/vendcast_planning_event-type-reclassification_2026-05-15.md),
-- operator-approved 2026-05-17. The new taxonomy collapses the old
-- 8-type food-truck list onto one coherent axis: what kind of revenue
-- moment the event is.
--
-- Postgres requires ADD VALUE to commit BEFORE any statement uses the
-- new value, so the reclassification UPDATEs are a SEPARATE migration
-- (step 2 — 20260517000002). Paste + run THIS file first, let it
-- commit, then run step 2.
--
-- The old enum values (Festival, Concert, Corporate, Weekly Series,
-- Community/Neighborhood, Sports Event, Fundraiser/Charity, Private,
-- Private/Catering) are intentionally left in place — Postgres cannot
-- cleanly drop enum values, the catering event-type list still uses
-- Corporate / Fundraiser/Charity, and historical-CSV round-trip relies
-- on them. They simply stop appearing in the food-truck event-form
-- dropdown.

ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Food Destination';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Festival/Fair';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Office/Workday Lunch';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Concert/Sports';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Community Event';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'Private Event';
