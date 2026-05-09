-- M-3 / M-4: extend manager RLS on event_performance + add DELETE on events.
--
-- Background: 20260417000002_add_team_members.sql granted managers
-- SELECT + INSERT + UPDATE on events, but NOT DELETE. event_performance
-- only got SELECT. Recalc pipeline writes performance rows on every
-- event mutation; without INSERT/UPDATE here, manager-triggered recalcs
-- silently fail (M-4). Without DELETE on events, deleteEvent server
-- action throws RLS-rejection for managers.
--
-- This migration completes the manager CRUD surface so the M-3 server-
-- action refactor (threading owner_user_id through scoped writes) can
-- actually succeed at the database level.
--
-- NOT INCLUDED: bulk operations like deleteAllEvents. Those remain
-- owner-only by code-level scope check (kind === "normal"), since
-- "delete every event your owner has" is a destructive action managers
-- shouldn't be able to fire even with policy permission.

CREATE POLICY "Managers delete owner events"
  ON events FOR DELETE
  USING (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Managers insert owner event_performance"
  ON event_performance FOR INSERT
  WITH CHECK (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Managers update owner event_performance"
  ON event_performance FOR UPDATE
  USING (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Managers delete owner event_performance"
  ON event_performance FOR DELETE
  USING (
    user_id IN (
      SELECT owner_user_id FROM team_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );
