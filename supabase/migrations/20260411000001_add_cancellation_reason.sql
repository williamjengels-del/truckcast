-- Add cancellation_reason to events
-- null = not cancelled
-- non-null = cancelled, with the reason stored
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cancellation_reason text
  CHECK (cancellation_reason IN ('weather', 'truck_breakdown', 'organizer_cancelled', 'other'));
