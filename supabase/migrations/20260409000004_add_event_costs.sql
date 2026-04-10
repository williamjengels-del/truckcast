-- Phase 8: Event cost tracking
-- Adds food cost, labor cost, and other costs columns to the events table.
-- These are operator-entered fields used to calculate actual profitability.
-- They are NEVER used in forecasting — forecasts are purely revenue-based.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS food_cost    numeric(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS labor_cost   numeric(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS other_costs  numeric(10, 2) DEFAULT NULL;

COMMENT ON COLUMN events.food_cost   IS 'Cost of goods sold for this event (ingredients, packaging, etc.)';
COMMENT ON COLUMN events.labor_cost  IS 'Labor / staffing cost for this event';
COMMENT ON COLUMN events.other_costs IS 'Other costs: supplies, fuel, parking, etc.';
