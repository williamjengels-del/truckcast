-- prep_items: shared kitchen-state checklists per operator.
--
-- Three free-text sections (on_hand / to_prep / to_buy) backing the
-- /dashboard/prep page. Operator-owned data, managers can read/write
-- only when team_members.prep_access = true. Not coupled to events or
-- forecasts in v1 — explicit operator framing was "let it evolve."
--
-- Manager permission shape mirrors the existing
-- team_members.financials_enabled toggle (see migration
-- 20260503000006_collapse_team_member_permissions.sql). New column is
-- off-by-default — owners explicitly grant prep_access. A "booking
-- manager" stays out; a "kitchen manager" gets checked in. Future
-- permissions get added as additional columns on team_members.

-- ── 1. prep_items table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prep_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('on_hand', 'to_prep', 'to_buy')),
  text text NOT NULL CHECK (length(text) > 0 AND length(text) <= 500),
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at timestamptz,
  done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- List-read predicate: per user_id + section, open items first, then
-- recent. Composite index covers the dashboard load.
CREATE INDEX IF NOT EXISTS prep_items_user_section_idx
  ON prep_items (user_id, section, done, created_at DESC);

ALTER TABLE prep_items ENABLE ROW LEVEL SECURITY;

-- ── 2. Owner RLS ───────────────────────────────────────────────────
CREATE POLICY "Owners read own prep items"
  ON prep_items FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Owners insert own prep items"
  ON prep_items FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners update own prep items"
  ON prep_items FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Owners delete own prep items"
  ON prep_items FOR DELETE
  USING (user_id = auth.uid());

-- ── 3. team_members.prep_access (off by default) ──────────────────
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS prep_access boolean NOT NULL DEFAULT false;

-- ── 4. Manager RLS — gated on team_members.prep_access ───────────
-- Mirrors the financials_enabled pattern in
-- 20260503000006_collapse_team_member_permissions.sql but for the
-- per-feature prep_access toggle.

CREATE POLICY "Managers read owner prep items"
  ON prep_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.member_user_id = auth.uid()
        AND team_members.owner_user_id = prep_items.user_id
        AND team_members.status = 'active'
        AND team_members.prep_access = true
    )
  );

CREATE POLICY "Managers insert owner prep items"
  ON prep_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.member_user_id = auth.uid()
        AND team_members.owner_user_id = prep_items.user_id
        AND team_members.status = 'active'
        AND team_members.prep_access = true
    )
  );

CREATE POLICY "Managers update owner prep items"
  ON prep_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.member_user_id = auth.uid()
        AND team_members.owner_user_id = prep_items.user_id
        AND team_members.status = 'active'
        AND team_members.prep_access = true
    )
  );

CREATE POLICY "Managers delete owner prep items"
  ON prep_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.member_user_id = auth.uid()
        AND team_members.owner_user_id = prep_items.user_id
        AND team_members.status = 'active'
        AND team_members.prep_access = true
    )
  );
