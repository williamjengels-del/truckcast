-- recalc_locks: per-user advisory lock for recalculateForUser.
--
-- Closes race-1 (operator double-clicking Refresh) plus race-3, race-4,
-- race-6, race-8 (concurrent recalcs from API + cron + Toast inbound +
-- server actions trampling each other on the same user).
--
-- Design: simple "claim row, release on completion" with a 5-minute
-- expiry so a crashed recalc doesn't permanently lock the user out.
-- The next caller after expiry steals the stale lock.
--
-- The acquire path is in `try_acquire_recalc_lock(uuid)` which runs the
-- INSERT-ON-CONFLICT-DO-UPDATE-WHERE-stale CAS. Returns true when the
-- caller now holds the lock, false when another live recalc is in-flight.
--
-- Runtime gating: src/lib/recalc-lock.ts probes for the function before
-- using it, so this migration can safely be applied late — the code
-- ships first and starts using the lock the moment the migration runs.

CREATE TABLE IF NOT EXISTS recalc_locks (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes')
);

ALTER TABLE recalc_locks ENABLE ROW LEVEL SECURITY;

-- Service role only. Operators never touch this table directly; all
-- access is via the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS "service_role_all" ON recalc_locks;
CREATE POLICY "service_role_all" ON recalc_locks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS recalc_locks_expires_at_idx ON recalc_locks (expires_at);

-- Atomic CAS: claim the lock if no live one exists. Returns true on
-- acquisition (fresh insert OR steal of expired row), false when a
-- non-expired lock is already held.
CREATE OR REPLACE FUNCTION try_acquire_recalc_lock(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ins AS (
    INSERT INTO recalc_locks(user_id, acquired_at, expires_at)
    VALUES (p_user_id, now(), now() + INTERVAL '5 minutes')
    ON CONFLICT (user_id) DO UPDATE
      SET acquired_at = EXCLUDED.acquired_at,
          expires_at = EXCLUDED.expires_at
      WHERE recalc_locks.expires_at < now()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ins);
$$;

-- Release. Caller is trusted to only release locks it acquired (the
-- lib wrapper does this in a try/finally).
CREATE OR REPLACE FUNCTION release_recalc_lock(p_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM recalc_locks WHERE user_id = p_user_id;
$$;

-- Authenticated users + service role can call the functions; the table
-- itself stays service-role-only.
GRANT EXECUTE ON FUNCTION try_acquire_recalc_lock(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_recalc_lock(UUID) TO authenticated, service_role;
