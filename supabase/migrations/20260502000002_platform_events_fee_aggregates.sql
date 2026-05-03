-- Cross-operator fee aggregates (Phase 1 follow-on, originally held pending
-- legal review, cleared 2026-05-02 by Julian).
--
-- Adds two organizer-side aggregates to platform_events:
--   modal_fee_type     — most-common fee structure across operators at this event
--   median_fee_rate    — typical fee rate alongside that
--
-- Privacy gate: 3+ contributing operators (slightly higher than the 2+ floor
-- on sales / attendance / other_trucks because fee structures combined with
-- event_name skew slightly more identifying — but still organizer-side data,
-- not operator-side competitive secret).
--
-- Schema discipline: additive nullable columns, populated by the next
-- recompute pass in platform-registry.ts. Privacy floor enforced at compute
-- time, not at schema level.

ALTER TABLE platform_events
  ADD COLUMN IF NOT EXISTS modal_fee_type  TEXT,
  ADD COLUMN IF NOT EXISTS median_fee_rate DECIMAL(10,2);

COMMENT ON COLUMN platform_events.modal_fee_type IS
  'Most-common fee_type across operators with this event_name. Null until recompute populates. Privacy floor 3+ contributing operators enforced at compute time.';

COMMENT ON COLUMN platform_events.median_fee_rate IS
  'Median fee_rate across operators with this event_name (matched to modal_fee_type). Null until recompute populates. Same privacy floor as above.';
