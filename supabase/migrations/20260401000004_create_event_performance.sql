-- Event Performance table (aggregated stats per recurring event)
CREATE TABLE event_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  times_booked INTEGER DEFAULT 0,
  total_sales DECIMAL(10,2) DEFAULT 0,
  avg_sales DECIMAL(10,2) DEFAULT 0,
  median_sales DECIMAL(10,2) DEFAULT 0,
  min_sales DECIMAL(10,2) DEFAULT 0,
  max_sales DECIMAL(10,2) DEFAULT 0,
  consistency_score DECIMAL(3,2) DEFAULT 0,
  yoy_growth DECIMAL(5,2),
  confidence confidence_level DEFAULT 'LOW',
  confidence_band_low DECIMAL(10,2),
  confidence_band_high DECIMAL(10,2),
  trend trend_type DEFAULT 'New/Insufficient Data',
  years_active TEXT,
  forecast_next DECIMAL(10,2),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, event_name)
);

CREATE INDEX idx_event_performance_user ON event_performance(user_id);

CREATE TRIGGER event_performance_updated_at
  BEFORE UPDATE ON event_performance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE event_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own event performance"
  ON event_performance FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own event performance"
  ON event_performance FOR ALL
  USING (auth.uid() = user_id);
