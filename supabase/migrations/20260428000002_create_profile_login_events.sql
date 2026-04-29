-- profile_login_events — per-login telemetry for new-device email
-- notifications.
--
-- One row per successful sign-in. The recording endpoint
-- (POST /api/auth/record-login) is called from the login form after
-- supabase.auth.signInWithPassword succeeds, and from /auth/callback
-- after exchangeCodeForSession succeeds. Both paths converge on
-- src/lib/login-events.ts:recordLogin().
--
-- New-device detection: a (ip, user_agent) combo not seen in this
-- user's last 30 days = new. Triggers an email
-- (src/lib/email.ts:sendNewDeviceLoginEmail).
--
-- Retention: 90 days via a future cron cleanup task. Older rows are
-- pruned. The table is for security signal, not long-term audit; if
-- audit-retention requirements emerge later we'd promote to a
-- separate audit table rather than extend this one.
--
-- RLS: operators read their own rows (a future "where have I signed
-- in?" UI can render directly). Inserts go through service role from
-- the recording endpoint.

CREATE TABLE IF NOT EXISTS profile_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- inet is Postgres' canonical IP type; supports both v4 and v6.
  ip inet,
  user_agent text,
  -- Best-effort geo from Vercel's request.geo (deprecation watched —
  -- see vendcast_planning_2fa-totp_2026-04-29.md §6).
  country text,
  city text,
  -- True when this (ip, user_agent) combo wasn't seen in the user's
  -- prior 30 days at recording time. The first-ever login for a user
  -- is silent (no email) — the flag is recorded so the email path
  -- can short-circuit for "is this user's first sign-in ever?"
  was_new_device boolean NOT NULL DEFAULT false,
  -- Set when the new-device email actually went out. Null when the
  -- login was on a known device or when send failed (errors are
  -- logged via Sentry but don't block the login).
  notification_sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_login_events_user_id_created_at
  ON profile_login_events(user_id, created_at DESC);

ALTER TABLE profile_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own login events"
  ON profile_login_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE profile_login_events IS
  'Login telemetry for new-device email notifications. See src/lib/login-events.ts.';
