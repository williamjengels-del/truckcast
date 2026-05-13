-- manager_audit_log: owner-visible history of every action a non-owner
-- (manager or admin-impersonating) takes against owner-scoped data.
--
-- Why: the team_members feature has been live since 20260417000002 but
-- the owner has no visibility into what their manager has touched once
-- the manager is acting on the owner's data. When the first manager
-- actually turns on (Sarah / Nick, imminent as of 2026-05-13), owner-
-- trust depends on being able to answer "what did my manager change?"
-- after the fact — financial edits, deletions, event metadata changes.
--
-- Scope: write-only at the application layer (via the audit writer in
-- src/lib/manager-audit-log.ts). Owners can SELECT their own rows.
-- Nobody can UPDATE/DELETE individual rows from the application layer —
-- the audit trail is immutable. The 365-day retention prune cron runs
-- under service role only (RLS bypassed).
--
-- Field discipline: the writer captures financial-impact + structural
-- fields only. Cosmetic edits (notes, content capture, in-service
-- jot, day-of menu details) are intentionally NOT captured to keep
-- the feed scannable.
--
-- actor_kind distinguishes manager actions from admin-impersonating
-- actions. Both go in the same log so the owner sees a unified
-- "who-touched-what" view for their account.

CREATE TABLE IF NOT EXISTS manager_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account whose data was touched. Owner sees their own log.
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The non-owner who took the action. Manager id for kind='manager',
  -- admin id for kind='impersonating'. Never equal to owner_user_id —
  -- the writer no-ops for normal scope.
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('manager', 'impersonating')),
  -- Action namespace: '<entity>.<verb>'. Examples:
  --   event.create / event.update / event.delete
  --   event.financial_edit (net_sales / invoice_revenue / fees touched)
  --   event.dismiss_flagged (Needs Attention dismissal)
  --   event.after_event_summary (wrap-up that may write net_sales)
  --   event.bulk_update (one row per affected event)
  --   inquiry.action (claim / decline / contacted)
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  -- Primary id of the affected row. Always populated by current writers;
  -- nullable to leave room for future entity-wide actions if needed.
  target_id UUID,
  -- Captured field state. Subset of the row's columns, financial +
  -- structural only. NULL on pure-create or pure-delete sides.
  before JSONB,
  after JSONB,
  -- Short human-readable summary the UI surfaces inline ("net_sales
  -- $1200 → $1500", "deleted event 'Lunchtime Live · 2026-05-07'").
  -- Writer composes this; readers don't have to reconstruct from
  -- before/after.
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary read path: Activity tab on /dashboard/settings/team, scoped
-- to owner_user_id, ordered newest-first.
CREATE INDEX IF NOT EXISTS manager_audit_log_owner_created_idx
  ON manager_audit_log (owner_user_id, created_at DESC);

-- Filter-by-manager read path: "show me only what Sarah did."
CREATE INDEX IF NOT EXISTS manager_audit_log_actor_idx
  ON manager_audit_log (actor_user_id);

-- Retention prune path: weekly cron deletes rows older than 365 days.
-- Partial-style index on created_at supports the lt-cutoff scan.
CREATE INDEX IF NOT EXISTS manager_audit_log_created_at_idx
  ON manager_audit_log (created_at);

ALTER TABLE manager_audit_log ENABLE ROW LEVEL SECURITY;

-- Owners SELECT their own rows. The actor (manager) does NOT get read
-- access to their own actions through this table — they can see their
-- effects on the underlying events table directly. The audit log is
-- the owner's view.
DROP POLICY IF EXISTS "Owners read own audit log" ON manager_audit_log;
CREATE POLICY "Owners read own audit log"
  ON manager_audit_log FOR SELECT
  USING (owner_user_id = auth.uid());

-- Service role does all writes (via the audit writer). No INSERT /
-- UPDATE / DELETE policies for authenticated — keeps the log immutable
-- from the application layer.
DROP POLICY IF EXISTS "service_role_all" ON manager_audit_log;
CREATE POLICY "service_role_all"
  ON manager_audit_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
