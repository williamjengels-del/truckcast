-- Add ON DELETE SET NULL to feedback.user_id FK.
--
-- Surfaced 2026-05-08 deep-dive data-integrity audit. The original
-- table at 20260402000002_create_feedback.sql:4 declared:
--   user_id UUID REFERENCES profiles(id)
-- which defaults to ON DELETE NO ACTION. Deleting a profile that has
-- any feedback rows would FAIL with a constraint violation.
--
-- The admin DELETE route at src/app/api/admin/users/route.ts:218
-- explicitly deletes feedback BEFORE the profile, which works in that
-- specific path. But any other profile delete (manual via dashboard,
-- cascade from auth.users on hard-delete from Supabase Auth UI) would
-- error mid-cascade and leave the operator's profile half-deleted —
-- some related rows gone, profile + auth.users intact, dashboard in
-- broken state.
--
-- Fix: drop the existing FK and re-add with ON DELETE SET NULL. The
-- feedback message itself stays in the table (we want the support
-- record), but the user_id pointer becomes null when the user goes
-- away. Anyone querying historical feedback can still read the message;
-- the join just returns no profile data.
--
-- Paste-at-merge per standing rule.

alter table public.feedback
  drop constraint if exists feedback_user_id_fkey;

alter table public.feedback
  add constraint feedback_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
