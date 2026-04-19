/**
 * In-memory sliding-window rate limit keyed on an arbitrary string
 * (typically an IP address).
 *
 * Tradeoff: Vercel serverless spawns separate function instances per
 * region, so in-memory state is not shared across instances. This is
 * best-effort bot deterrence, NOT hard security. For the contact form
 * (Commit: contact form) the primary bot defense is the honeypot
 * field; this rate limit catches the single-instance hammer case.
 *
 * If abuse ever materializes, upgrade to a Supabase-backed counter
 * (new table `rate_limit_events` with ip + ts, count via `gte`).
 */

interface BucketEntry {
  timestamps: number[];
}

const buckets = new Map<string, BucketEntry>();

/**
 * Check whether a request identified by `key` is within the rate
 * limit. Call BEFORE handling the request.
 *
 * @returns true if allowed, false if rate limit exceeded
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { timestamps: [now] });
    return true;
  }

  // Drop timestamps older than the window
  const recent = bucket.timestamps.filter((t) => t >= cutoff);

  if (recent.length >= limit) {
    // Keep the pruned list — no new timestamp on rejection (rejection
    // doesn't count as a fresh attempt for future windows).
    bucket.timestamps = recent;
    return false;
  }

  recent.push(now);
  bucket.timestamps = recent;
  return true;
}

/**
 * Housekeeping — drop buckets whose most recent entry is older than
 * the window. Call periodically or opportunistically; safe to skip.
 * Keeps the Map from growing unbounded across long-running instances.
 */
export function pruneRateLimitBuckets(windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [key, bucket] of buckets.entries()) {
    const mostRecent = bucket.timestamps[bucket.timestamps.length - 1] ?? 0;
    if (mostRecent < cutoff) {
      buckets.delete(key);
    }
  }
}
