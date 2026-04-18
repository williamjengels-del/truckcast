-- Audit log for all admin mutations (tier changes, user deletes, invite
-- generation, testimonial edits, impersonation, etc.).
--
-- Design notes:
--
-- * One row per admin action. Write-once — never updated, never deleted
--   by app code. If a row turns out to be wrong, file a new row that
--   corrects the record rather than mutating the original.
--
-- * `action` is a dotted machine-readable namespace
--   ("user.delete", "user.tier_change", "testimonial.update",
--   "invite.generate", "self.account_reset", "user.impersonate_start", ...).
--   Keep the vocabulary small and stable — the activity page filters on it.
--
-- * `target_type` + `target_id` identify what the action touched, when it
--   touched something. Text for both (not uuid) because some targets are
--   invite codes or arbitrary strings, not UUIDs.
--
-- * `metadata` holds action-specific context (old/new tier, count of
--   invites generated, days extended, list of fields updated). Readable
--   at a glance in the activity page without extra joins.
--
-- * `ip_address` + `user_agent` captured from request headers at log time.
--   Useful later for anomaly detection; nullable because they may not
--   always be available (local dev, edge rewrites).
--
-- * Service-role-only access. No end-user ever reads or writes this table
--   directly — the admin activity page goes through an API route that
--   re-checks admin status. RLS enabled with zero policies = deny-all for
--   auth'd users, service role bypasses as usual.

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Primary access pattern: "show me the most recent actions" — with
-- optional filter by admin (for when we have more than one). Index covers
-- both the unfiltered firehose and per-admin drilldown.
create index if not exists admin_actions_created_at_idx
  on public.admin_actions(created_at desc);

create index if not exists admin_actions_admin_user_id_idx
  on public.admin_actions(admin_user_id, created_at desc);

-- Secondary access pattern: "what's the history of this user/testimonial/
-- invite?" — answered from a future per-target drilldown view.
create index if not exists admin_actions_target_idx
  on public.admin_actions(target_type, target_id)
  where target_type is not null;

alter table public.admin_actions enable row level security;

-- Intentionally no policies. RLS-enabled-with-zero-policies denies every
-- request through the PostgREST API. The service role bypasses RLS, so
-- our admin routes (which already re-check admin status before
-- insert/select) remain the only path in.
