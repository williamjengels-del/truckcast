-- Events table
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  setup_time TIME,
  location TEXT,
  city TEXT,
  city_area TEXT,
  latitude DECIMAL,
  longitude DECIMAL,
  booked BOOLEAN DEFAULT true,
  net_sales DECIMAL(10,2),
  event_type event_type,
  event_tier event_tier,
  event_weather weather_type,
  anomaly_flag anomaly_flag DEFAULT 'normal',
  expected_attendance INTEGER,
  other_trucks INTEGER,
  fee_type fee_type DEFAULT 'none',
  fee_rate DECIMAL(10,2) DEFAULT 0,
  sales_minimum DECIMAL(10,2) DEFAULT 0,
  net_after_fees DECIMAL(10,2) GENERATED ALWAYS AS (
    CASE
      WHEN fee_type = 'none' OR fee_type = 'pre_settled' THEN net_sales
      WHEN fee_type = 'flat_fee' THEN net_sales - fee_rate
      WHEN fee_type = 'percentage' THEN net_sales * (1 - fee_rate / 100)
      WHEN fee_type = 'commission_with_minimum' THEN
        net_sales - (fee_rate / 100 * GREATEST(COALESCE(sales_minimum, 0), COALESCE(net_sales, 0)))
      ELSE net_sales
    END
  ) STORED,
  forecast_sales DECIMAL(10,2),
  notes TEXT,
  pos_source pos_source DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_events_user_date ON events(user_id, event_date);
CREATE INDEX idx_events_user_name ON events(user_id, event_name);
CREATE INDEX idx_events_user_type ON events(user_id, event_type);
CREATE INDEX idx_events_user_booked ON events(user_id, booked);

-- Updated_at trigger
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own events"
  ON events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own events"
  ON events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own events"
  ON events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own events"
  ON events FOR DELETE
  USING (auth.uid() = user_id);
