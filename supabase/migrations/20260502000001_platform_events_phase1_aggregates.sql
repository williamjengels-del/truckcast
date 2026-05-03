-- Cross-operator Phase 1 aggregates (Briefs/vendcast_planning_cross-operator-data_2026-04-30.md).
--
-- Adds two organizer-side aggregates to platform_events:
--   median_other_trucks      — competition density per event
--   median_attendance        — typical operator-estimated attendance
--
-- Phase 1 deliberately ships WITHOUT modal_fee_type / median_fee_rate
-- (Julian held those pending Tom legal review on whether fee
-- structures are operator-side competitive info).
--
-- Schema discipline: additive columns only, all nullable so the
-- recompute job in platform-registry.ts can populate them at its own
-- pace without breaking existing reads. Privacy floors and self-
-- filtering remain enforced upstream in platform-registry.ts; this
-- migration is schema only.

ALTER TABLE platform_events
  ADD COLUMN IF NOT EXISTS median_other_trucks DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS median_attendance   DECIMAL(10,2);

COMMENT ON COLUMN platform_events.median_other_trucks IS
  'Median other_trucks across operators with this event_name. Null until recompute populates. Privacy floor 2+ contributing operators enforced at compute time.';

COMMENT ON COLUMN platform_events.median_attendance IS
  'Median expected_attendance across operators with this event_name. Null until recompute populates. Same privacy floor as above.';
