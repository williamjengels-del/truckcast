-- Beta invite codes.
-- Julian generates invite codes from the admin panel.
-- Each code can be redeemed once at signup to grant a free Pro trial.

CREATE TABLE beta_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  email TEXT, -- optional: restrict to a specific email address
  granted_tier subscription_tier NOT NULL DEFAULT 'pro',
  trial_days INTEGER NOT NULL DEFAULT 60,
  redeemed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ -- NULL = no expiry
);

CREATE INDEX idx_beta_invites_code ON beta_invites(code);

-- RLS: only service role can insert/delete; anyone can check if a code is valid
ALTER TABLE beta_invites ENABLE ROW LEVEL SECURITY;

-- Users can check if a code exists and is unredeemed (needed at signup)
CREATE POLICY "Anyone can check invite codes"
  ON beta_invites FOR SELECT
  USING (true);

-- Only the user who redeemed can update their own redemption record
-- (Actual redemption done via service role in API route)
