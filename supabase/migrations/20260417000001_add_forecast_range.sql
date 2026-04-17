-- Add forecast range columns to events table.
-- forecast_low / forecast_high express the confidence interval around forecast_sales.
-- forecast_confidence stores the label (HIGH / MEDIUM / LOW) from the engine.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS forecast_low  DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS forecast_high DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS forecast_confidence TEXT CHECK (forecast_confidence IN ('HIGH', 'MEDIUM', 'LOW'));
