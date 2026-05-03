-- Cross-operator Phase 2 weather aggregates
-- (Briefs/vendcast_planning_cross-operator-data_2026-04-30.md, Phase 2).
--
-- Adds modal_weather_by_month: a jsonb column on platform_events keyed by
-- numeric month-of-year (1-12) with the most-common event_weather observed
-- across operators for that event_name in that month.
--
-- Shape:
--   {
--     "4":  { "weather": "Clear",              "count": 8 },
--     "5":  { "weather": "Rain Before Event",  "count": 5 },
--     "10": { "weather": "Overcast",           "count": 3 }
--   }
--
-- Why month-of-year (not season buckets): seasons differ by hemisphere and
-- operators ask in months ("how's October at this event?"). 12 keys max is
-- small for jsonb.
--
-- Privacy gate: 3+ operators per (event_name × month) cell — combined with
-- weather, the cell becomes meaningfully identifying, so we use the higher
-- floor (same as fee aggregates) rather than the 2+ floor on sales/attendance.
-- Months below the floor are simply absent from the jsonb (no "weather: null"
-- placeholder).
--
-- Schema discipline: additive nullable column; recompute populates at its own
-- pace. No data migration, no locks.

ALTER TABLE platform_events
  ADD COLUMN IF NOT EXISTS modal_weather_by_month jsonb;

COMMENT ON COLUMN platform_events.modal_weather_by_month IS
  'Per-month modal event_weather across operators with this event_name. Shape: { "<month-of-year>": { "weather": "<WeatherType>", "count": N }, ... }. Privacy floor 3+ operators per cell, enforced at compute time. Months below the floor are absent from the jsonb (not null-placeholder).';
