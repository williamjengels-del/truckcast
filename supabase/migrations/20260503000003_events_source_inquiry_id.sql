-- Phase 7c: link events back to the marketplace inquiry that birthed
-- them. When an operator clicks Claim on an inbox inquiry, the action
-- route creates an event row pre-filled from the inquiry — this column
-- is the audit trail.
--
-- Nullable: existing events (and any future operator-created events not
-- sourced from inquiries) carry NULL here.
--
-- ON DELETE SET NULL: deleting the source inquiry shouldn't cascade-
-- delete the operator's events. The operator's planning record is
-- theirs once claimed.
--
-- Unique index (user_id, source_inquiry_id) WHERE source_inquiry_id IS
-- NOT NULL: idempotency. Re-clicking Claim on an inquiry already
-- claimed by this user should never create a second event row. The
-- partial-WHERE keeps the constraint from blocking the common case of
-- many events with NULL source_inquiry_id per user.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source_inquiry_id UUID
    REFERENCES event_inquiries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_user_source_inquiry
  ON events(user_id, source_inquiry_id)
  WHERE source_inquiry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_source_inquiry
  ON events(source_inquiry_id)
  WHERE source_inquiry_id IS NOT NULL;
