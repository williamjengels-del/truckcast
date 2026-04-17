-- Team members: allows owners to invite managers to their account.
-- Managers get their own login but operate within the owner's data scope.

CREATE TABLE IF NOT EXISTS team_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  member_email      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  can_view_revenue  BOOLEAN NOT NULL DEFAULT false,
  can_view_forecasts BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, member_email)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Owners can do everything with their own team records
CREATE POLICY "Owners manage their team"
  ON team_members FOR ALL
  USING (owner_user_id = auth.uid());

-- Members can read their own membership record (to know permissions)
CREATE POLICY "Members read own membership"
  ON team_members FOR SELECT
  USING (member_user_id = auth.uid());

-- Add owner_user_id to profiles so managers carry a pointer to their owner
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- ── RLS policies so managers can access owner's events ──────────────────────

-- Managers can read owner's events
CREATE POLICY "Managers read owner events"
  ON events FOR SELECT
  USING (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

-- Managers can insert events under the owner's user_id
CREATE POLICY "Managers insert owner events"
  ON events FOR INSERT
  WITH CHECK (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

-- Managers can update owner's events
CREATE POLICY "Managers update owner events"
  ON events FOR UPDATE
  USING (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

-- Managers can read owner's event_performance
CREATE POLICY "Managers read owner event_performance"
  ON event_performance FOR SELECT
  USING (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

-- Managers can read owner's profile (for business name, city, tier etc.)
CREATE POLICY "Managers read owner profile"
  ON profiles FOR SELECT
  USING (
    id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );
