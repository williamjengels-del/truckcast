-- Add 'sold_out' to the cancellation_reason CHECK constraint.
--
-- Surfaces the operator pattern where a NEXT-day event has to be
-- cancelled because a PREVIOUS-day event sold out of food/inventory.
-- That's a positive outcome (high demand) being recorded as a
-- cancellation — distinct from weather / breakdown / organizer-cancel
-- which are negative outcomes. Statistical treatment is identical for
-- now (cancelled events are excluded from sales reminders + sidebar
-- state via the existing `cancellation_reason IS NULL` filters).
--
-- Drops + recreates the check; existing rows are unaffected (their
-- values are all in the original 4-value set).

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_cancellation_reason_check;

ALTER TABLE events
  ADD CONSTRAINT events_cancellation_reason_check
  CHECK (
    cancellation_reason IN (
      'weather',
      'truck_breakdown',
      'organizer_cancelled',
      'sold_out',
      'other'
    )
  );
