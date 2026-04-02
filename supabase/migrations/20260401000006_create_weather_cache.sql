-- Weather cache table
CREATE TABLE weather_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  latitude DECIMAL NOT NULL,
  longitude DECIMAL NOT NULL,
  max_temp_f DECIMAL(5,1),
  min_temp_f DECIMAL(5,1),
  precipitation_in DECIMAL(5,2),
  prev_day_precip_in DECIMAL(5,2),
  weather_classification weather_type,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, latitude, longitude)
);

CREATE INDEX idx_weather_cache_date_loc ON weather_cache(date, latitude, longitude);

-- Weather cache is not user-scoped — shared data
-- No RLS needed, but restrict to authenticated users
ALTER TABLE weather_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read weather cache"
  ON weather_cache FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert weather cache"
  ON weather_cache FOR INSERT
  TO authenticated
  WITH CHECK (true);
