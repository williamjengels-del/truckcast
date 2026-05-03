-- Backfill for the manager-accept-invite bug fixed in PR shipped
-- 2026-05-03. The previous client-side accept flow silently failed
-- on the team_members UPDATE (RLS blocks the manager from writing
-- their own pending row), and even when the profile UPDATE that
-- followed succeeded, no atomicity. Result: live managers ended up
-- "active" in some views but with profiles.owner_user_id=NULL,
-- leaking into Phase 7 marketplace routing as if they were
-- independent operators.
--
-- This migration normalizes the existing broken state. For every
-- team_members row with status='active' and a non-null
-- member_user_id, it ensures the corresponding profile is
-- correctly linked:
--   - profiles.owner_user_id set to the team_members.owner_user_id
--   - profiles.business_name cleared (managers don't carry
--     independent brand identity)
--   - profiles.city cleared (managers shouldn't appear in marketplace
--     routing matched_operator_ids)
--   - profiles.onboarding_completed forced false
--
-- Idempotent: re-running on already-correct rows is a no-op (same
-- values written). The legacy column member_user_id may be NULL on
-- rows where the previous accept flow didn't even reach the
-- profiles update — those rows can't be backfilled here without
-- guessing the email-to-user-id mapping; if they exist, the
-- operator can re-invite to clean them up.
--
-- Safe to run multiple times.

BEGIN;

UPDATE profiles p
SET
  owner_user_id = tm.owner_user_id,
  business_name = NULL,
  city = NULL,
  onboarding_completed = false
FROM team_members tm
WHERE tm.member_user_id = p.id
  AND tm.status = 'active'
  AND (
    p.owner_user_id IS DISTINCT FROM tm.owner_user_id
    OR p.business_name IS NOT NULL
    OR p.city IS NOT NULL
    OR p.onboarding_completed = true
  );

COMMIT;
