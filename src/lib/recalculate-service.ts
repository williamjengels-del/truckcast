/**
 * Service-role variant of recalculateForUser.
 *
 * Thin wrapper that forwards a pre-built service-role client to the
 * canonical recalculateForUser pipeline. Callers (Toast email inbound,
 * POS cron, admin mutation routes) already have a service client in
 * hand and shouldn't pay the cookie-bind cost — they pass it through.
 *
 * Pre-2026-05-06, this was a stripped-down divergent copy that wrote
 * only forecast_sales (no forecast_low/_high/_confidence, no platform
 * blend fetch, no past-event backfill). Any mutation path running
 * through this lib silently produced range-less event rows. Now it
 * delegates so the lib + route + service paths run the same pipeline.
 */

import { recalculateForUser } from "@/lib/recalculate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recalculateForUserWithClient(userId: string, supabase: any) {
  return recalculateForUser(userId, supabase);
}
