-- Day-of Event Card v1 — schema additions for the actionable cockpit.
-- Spec: Briefs/vendcast_day_of_event_card_v1_spec.md (§"Data Model Adds")
--
-- The card replaces the passive "Today's Event" block with operator-
-- facing controls (parking/load-in notes, menu indicator, in-service
-- notes, content capture, after-event summary). All fields live on
-- the events row under the existing RLS — operators read/write their
-- own rows; no admin gating.
--
-- Migration safety:
--   - The pre-existing `notes` column is left untouched. Operator-
--     entered context there (e.g., Playday in the Park 2026-05-30 has
--     historical confirmation + location-change notes) MUST survive
--     this migration. parking_loadin_notes is a NEW field, not a
--     rename of `notes`.
--   - All adds are nullable / defaulted; no backfill required.
--
-- menu_type uses a CHECK constraint rather than CREATE TYPE — matches
-- the existing cancellation_reason convention (20260411000001) and
-- keeps the migration trivially reversible if v1 scope shifts.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS parking_loadin_notes text NULL;

COMMENT ON COLUMN events.parking_loadin_notes IS
  'Free-text load-in / parking instructions surfaced under the address on the day-of card. Distinct from events.notes (general operator notes).';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS menu_type text NOT NULL DEFAULT 'regular'
  CHECK (menu_type IN ('regular', 'special'));

COMMENT ON COLUMN events.menu_type IS
  'Day-of menu indicator. ''regular'' = standard menu, ''special'' = catering/limited/themed menu (details in special_menu_details).';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS special_menu_details text NULL;

COMMENT ON COLUMN events.special_menu_details IS
  'Free-text or URL describing the special menu when menu_type = ''special''. PDF link, Google Doc, or short summary.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS in_service_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN events.in_service_notes IS
  'Append-only array of in-service operator notes. Each entry: { timestamp: ISO string, text: string }. Examples: "Bulgogi sold out at 12:40", "Line crashed when SLSO let out".';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS content_capture_notes text NULL;

COMMENT ON COLUMN events.content_capture_notes IS
  'Free-form content-capture scratchpad: B-roll moments, story ideas, photo references. Unstructured by design for v1; structured forecastability is future work.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS after_event_summary jsonb NULL;

COMMENT ON COLUMN events.after_event_summary IS
  'Operator-completed wrap-up: { final_sales: number | null, wrap_up_note: string | null, what_id_change: string | null }. Surfaced during the auto-end transition; non-blocking — operator can fill from the event table later.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS auto_ended_at timestamptz NULL;

COMMENT ON COLUMN events.auto_ended_at IS
  'Audit field. Set by the server-side auto-end path when an event passes its end_time without operator action. Null = not auto-ended (still active OR operator-marked complete OR not yet ended).';
