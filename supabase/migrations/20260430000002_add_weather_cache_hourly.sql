-- Add hourly weather cache to the existing weather_cache row.
-- Day-of card v1: Pro tier gets a service-window summary; Premium
-- gets the hourly chart + wind alert. Both need hour-resolution data
-- that the existing daily-only cache can't satisfy.
--
-- Storage choice: jsonb column on the existing (date, lat, lon)
-- composite key rather than a new table with 24 rows per cache entry.
-- One row per cache hit keeps geographic-radius lookups + read paths
-- the same as today; the jsonb just becomes "do we have it" detail.
--
-- Shape:
--   hourly_data: [
--     { hour: 0..23,  -- operator-local hour-of-day (Open-Meteo
--                       returns timezone-aware data when called with
--                       &timezone=auto)
--       temp_f: number,
--       weather_code: number, -- WMO code (used for condition string)
--       wind_mph: number,
--       precip_in: number
--     }
--   ]
--
-- Null-defaulted: existing cache rows without hourly data continue to
-- read fine; the day-of card falls back to the daily summary when
-- hourly is missing (or for Starter operators who don't see it at all).
--
-- fetched_hourly_at: separate from fetched_at because hourly is
-- populated lazily on first day-of card render, not at event-save
-- time. Tracking the timestamp lets a future cache-staleness sweep
-- target hourly data independently.

ALTER TABLE weather_cache
  ADD COLUMN IF NOT EXISTS hourly_data jsonb NULL,
  ADD COLUMN IF NOT EXISTS fetched_hourly_at timestamptz NULL;

COMMENT ON COLUMN weather_cache.hourly_data IS
  'Per-hour weather forecast for the cached date, from Open-Meteo (free tier). Array indexed 0-23 by operator-local hour. Null = not yet fetched OR hourly fetch failed.';

COMMENT ON COLUMN weather_cache.fetched_hourly_at IS
  'When hourly_data was last refreshed. Decoupled from fetched_at because hourly is populated lazily on day-of card render, not at event-save time.';
