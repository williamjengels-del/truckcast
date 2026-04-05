-- Add last_sync_events_updated to track how many events were updated in last auto-sync
ALTER TABLE pos_connections ADD COLUMN IF NOT EXISTS last_sync_events_updated INTEGER DEFAULT 0;
