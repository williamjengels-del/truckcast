-- Cross-operator Phase 3 DOW pattern aggregates
-- (Briefs/vendcast_planning_cross-operator-data_2026-04-30.md, Phase 3).
--
-- Adds dow_lift: a jsonb column on platform_events keyed by day-of-week
-- index (0=Sunday through 6=Saturday, matching Date.getDay()) with the
-- relative performance vs the event's own median across operators.
--
-- Shape:
--   {
--     "0": { "lift_pct": -8,  "count": 4 },  // Sunday  — 8% below event median
--     "5": { "lift_pct":  5,  "count": 6 },  // Friday  — 5% above event median
--     "6": { "lift_pct": 23,  "count": 9 }   // Saturday — 23% above event median
--   }
--
-- Why a relative lift instead of absolute dollars: per the planning brief,
-- "Saturday is 23% above the cross-operator median" is more useful than
-- "Saturday averages $1,450" because it normalizes across event scales.
-- Operators care whether Saturday outperforms Sunday at THIS event, not
-- the absolute number.
--
-- Privacy gate: 3+ DISTINCT operators per (event_name × DOW) cell.
-- DOW + event_name is distinctive enough that the higher floor matches
-- weather/fee aggregates. Cells below the floor are absent from the
-- jsonb (no null placeholder).
--
-- Schema discipline: additive nullable column. No data migration, no locks.

ALTER TABLE platform_events
  ADD COLUMN IF NOT EXISTS dow_lift jsonb;

COMMENT ON COLUMN platform_events.dow_lift IS
  'Per-DOW relative performance lift across operators with this event_name. Shape: { "<dow>": { "lift_pct": <integer>, "count": N }, ... } where dow is 0=Sun..6=Sat (Date.getDay()) and lift_pct is the integer percent above (positive) or below (negative) the event-wide median across operators. Privacy floor 3+ operators per cell, enforced at compute time. Cells below the floor are absent from the jsonb.';
