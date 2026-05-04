-- Collapse manager permissions from two booleans to one.
--
-- Background: PR #160 shipped two separate toggles on team_members
-- (can_view_revenue, can_view_forecasts). The mental model is simpler
-- with one: revenue and forecasts are both "money the operator's
-- business is doing" and they reveal each other anyway (a forecast
-- against past revenue doesn't make sense without the underlying
-- revenue). Collapsing to a single Financials toggle also matches the
-- expanded permissions matrix landing in this workstream — Operations
-- (always on) and Financials (owner-controlled).
--
-- Migration is conservative: financials_enabled = TRUE only when BOTH
-- prior toggles were TRUE. If either was off, we default to off so
-- owners opt back in deliberately rather than silently broaden a
-- partial trust grant.
--
-- Also adds RLS policies that let managers read and update inquiries
-- routed to their owner. Mirrors the existing
-- "Managers read/update/insert owner events" pattern from
-- 20260417000002_add_team_members.sql. Without this, the inquiries
-- inbox returns 0 rows for managers because the existing
-- "Operators read matched inquiries" policy filters by
-- auth.uid() = ANY(matched_operator_ids) — managers' UUIDs are never
-- in that array (only the owner's is, by design — the routing-side
-- filter at src/lib/event-inquiry-routing.ts:53 excludes managers
-- from being matched).

-- ── 1. Add new column ───────────────────────────────────────────────
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS financials_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Populate from existing booleans ──────────────────────────────
UPDATE team_members
SET financials_enabled = (can_view_revenue AND can_view_forecasts)
WHERE financials_enabled = false;

-- ── 3. Drop legacy columns ──────────────────────────────────────────
ALTER TABLE team_members DROP COLUMN IF EXISTS can_view_revenue;
ALTER TABLE team_members DROP COLUMN IF EXISTS can_view_forecasts;

-- ── 4. Manager RLS for event_inquiries ──────────────────────────────
-- Managers can SELECT inquiries routed to their owner.
CREATE POLICY "Managers read owner inquiries"
  ON event_inquiries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.member_user_id = auth.uid()
        AND team_members.status = 'active'
        AND team_members.owner_user_id = ANY(event_inquiries.matched_operator_ids)
    )
  );

-- Managers can UPDATE inquiries routed to their owner. Application code
-- still attributes action keys to the owner's UUID, not the manager's,
-- so operator_actions stays keyed consistently.
CREATE POLICY "Managers update owner inquiries"
  ON event_inquiries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.member_user_id = auth.uid()
        AND team_members.status = 'active'
        AND team_members.owner_user_id = ANY(event_inquiries.matched_operator_ids)
    )
  );
