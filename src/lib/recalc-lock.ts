/**
 * Per-user advisory lock for recalculateForUser. Closes race-1 (operator
 * double-clicking Refresh) plus race-3/4/6/8 (concurrent recalcs from
 * other call sites trampling each other on the same user).
 *
 * Design intent (paired with migration 20260509000004_recalc_locks.sql):
 *   - tryAcquireRecalcLock returns 'acquired' | 'busy' | 'not-installed'
 *   - 'not-installed' is the safe-fallback for the paste-at-merge window
 *     between code deploy and operator pasting the migration. Caller
 *     proceeds without locking, identical to current behavior.
 *   - 5-minute expiry on the lock row defends against crashed recalcs
 *     leaving a permanent block — the next caller steals stale locks.
 *   - Always release in a try/finally — never bypass.
 *
 * NOT USED FOR: cross-user concurrency (intentional — different users'
 * recalcs are independent), cross-process cron coordination beyond
 * "at most one recalc per user at a time" (which is exactly what we
 * want anyway).
 */

export type LockState = "acquired" | "busy" | "not-installed";

export async function tryAcquireRecalcLock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<LockState> {
  try {
    const { data, error } = await supabase.rpc("try_acquire_recalc_lock", {
      p_user_id: userId,
    });
    if (error) {
      // 42883 = function does not exist — migration not yet applied.
      // Treat as not-installed so the caller proceeds without locking.
      // Anything else is logged but also not-installed (don't block the
      // recalc on lock-infrastructure errors).
      if (error.code === "42883" || /try_acquire_recalc_lock/.test(error.message ?? "")) {
        return "not-installed";
      }
      console.warn("[recalc-lock] acquire error:", error);
      return "not-installed";
    }
    return data === true ? "acquired" : "busy";
  } catch (e) {
    console.warn("[recalc-lock] acquire threw:", e);
    return "not-installed";
  }
}

export async function releaseRecalcLock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc("release_recalc_lock", {
      p_user_id: userId,
    });
    if (error && error.code !== "42883") {
      // Function-missing is silent (paste-at-merge window). Anything
      // else is worth surfacing — a stuck row will block subsequent
      // recalcs for 5 min until the expiry sweep.
      console.warn("[recalc-lock] release error:", error);
    }
  } catch (e) {
    console.warn("[recalc-lock] release threw:", e);
  }
}
