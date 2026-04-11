-- Add email notification preference to profiles
-- Default true: existing users keep receiving reminders unless they opt out.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_reminders_enabled boolean DEFAULT true;
