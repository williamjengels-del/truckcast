-- Add location_names JSONB column to pos_connections
-- Stores a map of { locationId: locationName } so the UI can show
-- human-readable names instead of raw Square/Clover location IDs.

ALTER TABLE pos_connections
  ADD COLUMN IF NOT EXISTS location_names jsonb NOT NULL DEFAULT '{}';
