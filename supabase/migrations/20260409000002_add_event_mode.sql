-- Event mode: food_truck (open market events) vs catering (private, contracted)
DO $$ BEGIN
  CREATE TYPE event_mode AS ENUM ('food_truck', 'catering');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE events ADD COLUMN IF NOT EXISTS event_mode event_mode DEFAULT 'food_truck';
