-- Phase 7c+: per-operator private notes on each marketplace inquiry.
-- Lets the operator jot follow-up context ("called Sarah Mon, budget
-- might rise to $2k") that's invisible to the organizer and to other
-- matched operators.
--
-- Stored as jsonb keyed by operator user_id so a single inquiry row
-- can carry distinct notes from each matched operator without joins.
-- Mirrors the operator_actions jsonb shape for consistency.
--
-- RLS: read/write access inherits from the parent event_inquiries row
-- — only operators in matched_operator_ids can update, which the
-- existing policies already enforce. No new policy needed.

ALTER TABLE event_inquiries
  ADD COLUMN IF NOT EXISTS operator_notes_by_user JSONB
    NOT NULL DEFAULT '{}'::jsonb;
