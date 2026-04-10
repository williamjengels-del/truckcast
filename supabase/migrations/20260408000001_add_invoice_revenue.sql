-- Add invoice_revenue to events table.
-- Stores revenue collected via invoice (e.g. catering deposits, net-30 payments)
-- separately from POS net_sales so it doesn't skew event-level forecasting.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS invoice_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0;
