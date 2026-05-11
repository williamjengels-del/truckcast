-- Contacts: city, location, linked_event_ids (FK array)
--
-- Operator surfaced 2026-05-11: the Airtable contacts table he wants to
-- migrate from carries City + Location columns + multi-event-link
-- per contact, and his current VendCast contacts schema doesn't have
-- equivalents. linked_event_names is a soft string-array link that
-- breaks on event renames and ambiguates on name collisions.
--
-- Scope:
--   - Add city + location (free-text fields, parallel to events.city /
--     events.location).
--   - Add linked_event_ids (UUID[]) as the new FK array. v1 keeps both
--     linked_event_names AND linked_event_ids; new writes go to ids,
--     reads prefer ids and fall back to names for any not-yet-migrated
--     rows. After ~one rollout cycle, a follow-up migration drops
--     linked_event_names entirely.
--   - GIN index on linked_event_ids for reverse-lookup queries: "which
--     contacts link to event X?" The events-list inline-contact display
--     uses .contains() / array-overlap, which is O(N rows) without
--     this index.
--   - Backfill linked_event_ids from linked_event_names by matching
--     event_name within the same user_id. Idempotent.
--
-- The migration deliberately does NOT drop linked_event_names. Operator
-- can decide when to retire it after verifying the new path works.
-- quality_score is also untouched — reserved for the deferred contact-
-- scoring workstream.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS linked_event_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS contacts_linked_event_ids_gin
  ON contacts USING GIN (linked_event_ids);

-- Backfill: for each contact, find events under the same user_id whose
-- event_name appears in linked_event_names. Aggregate IDs into the new
-- array column.
--
-- COALESCE handles the case where ARRAY_AGG returns NULL (no matching
-- events found — the operator's name-based link points at events that
-- have since been renamed or deleted).
UPDATE contacts c
SET linked_event_ids = COALESCE((
  SELECT ARRAY_AGG(DISTINCT e.id)
  FROM events e
  WHERE e.user_id = c.user_id
    AND e.event_name = ANY(c.linked_event_names)
), '{}')
WHERE c.linked_event_names IS NOT NULL
  AND array_length(c.linked_event_names, 1) > 0
  AND array_length(c.linked_event_ids, 1) IS NULL;
