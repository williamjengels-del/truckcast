-- Data sharing preference.
-- Controls whether a user's event data is included in TruckCast's
-- internal model improvement dataset. Defaults to true (opt-out model).
-- Disclosed in the Privacy Policy and at signup.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS data_sharing_enabled BOOLEAN NOT NULL DEFAULT true;
