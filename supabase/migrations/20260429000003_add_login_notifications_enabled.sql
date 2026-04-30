-- profiles.login_notifications_enabled — operator-level kill switch for
-- new-device login email notifications.
--
-- Default true so existing operators continue receiving alerts; new
-- operators inherit the same default (notifications-on by feature
-- baseline). The toggle lands on /dashboard/settings?tab=notifications.
--
-- Recording always happens (profile_login_events table is unaffected) —
-- this flag only short-circuits the email send in
-- src/app/api/auth/record-login/route.ts. That keeps the security audit
-- trail intact even when the operator has muted the email channel.
--
-- The pre-existing email_reminders_enabled column governs the unrelated
-- sales-reminder cron emails. They share a tab in the UI but should not
-- share a column — one is a behavioral nudge cadence, the other is a
-- security signal.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS login_notifications_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN profiles.login_notifications_enabled IS
  'Operator opt-in for new-device login email notifications. Recording is unaffected.';
