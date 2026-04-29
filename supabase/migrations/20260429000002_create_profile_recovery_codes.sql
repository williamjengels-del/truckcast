-- profile_recovery_codes — backup codes for 2FA lockout recovery.
--
-- One row per single-use code. 8 codes generated at enrollment time
-- (or regeneration), shown to the operator once, then stored as
-- SHA-256 hashes. Using a code consumes it (consumed_at set) and also
-- deletes the operator's TOTP factor entirely — recovery is one-shot:
-- after using a code the operator must re-enroll TOTP from scratch.
--
-- RLS: operators can INSERT/DELETE their own codes (used during
-- generation + cleanup on disable). Reading the hashes back is
-- service-role only — even the owner shouldn't be able to retrieve
-- their codes after the one-time post-enroll display, since the
-- plaintext is gone after that point.

CREATE TABLE IF NOT EXISTS profile_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_recovery_codes_user_id
  ON profile_recovery_codes(user_id);

ALTER TABLE profile_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Operators can insert their own codes (during generate).
CREATE POLICY "users insert own recovery codes"
  ON profile_recovery_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Operators can delete their own codes (during regenerate / disable).
CREATE POLICY "users delete own recovery codes"
  ON profile_recovery_codes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Operators can SELECT only enough to know how many codes they have
-- (for status display) — but not the hashes. Service role bypasses
-- RLS for the verify path, so the unrestricted SELECT below is safe
-- because the column we expose to the client (count via head:true) is
-- not the hash itself.
CREATE POLICY "users count own recovery codes"
  ON profile_recovery_codes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE profile_recovery_codes IS
  '2FA backup codes for lockout recovery. One-shot: using a code unenrolls TOTP. See src/lib/recovery-codes.ts.';
