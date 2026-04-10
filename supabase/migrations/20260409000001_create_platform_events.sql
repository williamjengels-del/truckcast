-- Platform event registry
-- Aggregated cross-user stats per named event.
-- Authenticated users can read. Only service role writes (via server-side aggregation).

CREATE TABLE IF NOT EXISTS platform_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name_normalized TEXT NOT NULL UNIQUE,
  event_name_display TEXT NOT NULL,
  operator_count INTEGER NOT NULL DEFAULT 0,
  total_instances INTEGER NOT NULL DEFAULT 0,
  median_sales DECIMAL(10,2),
  avg_sales DECIMAL(10,2),
  min_sales DECIMAL(10,2),
  max_sales DECIMAL(10,2),
  sales_p25 DECIMAL(10,2),
  sales_p75 DECIMAL(10,2),
  most_common_event_type TEXT,
  most_common_city TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read platform_events"
  ON platform_events FOR SELECT
  TO authenticated
  USING (true);
