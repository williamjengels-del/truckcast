-- One-off platform cleanup: backfill trial_extended_until for beta users.
--
-- Ran against production 2026-04-19 via PostgREST (service role).
-- 14 rows updated. Idempotent re-run returns 0 rows (filter includes
-- `trial_extended_until IS NULL`, and all matching rows now have it set).
--
-- Context:
--   Before commit 3932a6f, /api/beta/redeem set subscription_tier on the
--   profile but left trial_extended_until untouched. The middleware
--   trial gate bypasses only on stripe_subscription_id — beta users
--   don't have one — so every active beta Pro/Premium user was heading
--   toward the HARD_GATE_DATE (2026-05-01) on the default 14-day
--   created_at window, after which they'd be redirected to
--   /dashboard/upgrade despite their granted tier.
--
--   3932a6f fixes the behavior for future redemptions. This script
--   backfills the 14 existing beta users.
--
-- Treatment: uniform 60-day extension from today for all affected rows,
-- per Julian's call. Simpler than re-deriving each user's original
-- invite.trial_days (the beta_invites rows still exist but the mapping
-- invite → profile is preserved only via beta_invites.redeemed_by —
-- workable, but a uniform 60-day reset is cleaner for a one-off).
--
-- Filter:
--   subscription_tier != 'starter'       — i.e. granted via beta
--   stripe_subscription_id IS NULL       — not paying via Stripe
--   trial_extended_until IS NULL         — not already extended
--
-- No audit log row written — this is platform-level cleanup, not a
-- per-user admin action.
--
-- This file is a record of what ran, committed for reproducibility.
-- Safe to re-execute against production at any time; the IS NULL
-- predicate makes it a no-op after the initial application.

UPDATE profiles
SET trial_extended_until = now() + interval '60 days'
WHERE subscription_tier != 'starter'
  AND stripe_subscription_id IS NULL
  AND trial_extended_until IS NULL;
