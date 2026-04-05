-- Organizer quality scoring fields (Premium feature).
--
-- quality_score: 0.0–10.0, computed from linked event performance data.
-- linked_event_names: event_name values from the events table that this
--   organizer runs. Users link these in the Contacts UI.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS quality_score DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS linked_event_names TEXT[] DEFAULT '{}';
