-- Add trial_extended_until to profiles so admins can manually extend trial periods
-- for beta users who don't have a Stripe subscription.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_extended_until TIMESTAMPTZ DEFAULT NULL;
