-- events.caused_by_event_id — link a sold-out cancellation to the prior
-- event that caused it.
--
-- Operator scenario (v25 §2c): Saturday sold out — operator empties the
-- truck. Sunday is cancelled with cancellation_reason = "sold_out". Today,
-- Sunday's $0 unfairly drags down forecast accuracy because the model
-- expected revenue. With caused_by_event_id pointing at Saturday, the
-- stats engine can exclude Sunday's $0 from accuracy denominators
-- (Saturday's overrun is the credited outcome) and the display can render
-- "Sold out (carry-over from Saturday's event)" instead of "$0 sales."
--
-- ON DELETE SET NULL — if the upstream event is deleted, the linkage
-- evaporates but the cancelled row survives with its data intact.
--
-- Index — supports the auto-suggest query in event-form.tsx that pulls
-- candidate "what caused this?" events from the prior 3 days. Composite
-- on (user_id, caused_by_event_id) covers both the "events caused by X"
-- lookup and operator-scoped scans where the linkage is read.
--
-- The schema is intentionally generous: any cancellation can carry the
-- linkage, not just sold_out ones. The UI only surfaces the picker when
-- cancellation_reason = sold_out (today), but the column is honest about
-- "this cancellation was caused by another event" — which is also true
-- for, e.g., truck breakdowns that cascaded into the next day. We can
-- expand the UI later without a second migration.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS caused_by_event_id uuid NULL
    REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_user_id_caused_by_event_id
  ON events(user_id, caused_by_event_id)
  WHERE caused_by_event_id IS NOT NULL;

COMMENT ON COLUMN events.caused_by_event_id IS
  'Optional link to a prior event whose outcome caused this one (e.g., sold-out spillover). Stats engine excludes rows where this is non-null from accuracy denominators.';
