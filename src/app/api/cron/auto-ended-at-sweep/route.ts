import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/auto-ended-at-sweep
 *
 * Stamps `auto_ended_at` on past, booked events that nobody opened the
 * day-of card to render. The day-of card itself does a lazy
 * fire-and-forget write on render, so events viewed after they end
 * already get stamped — this cron is the safety net for operators who
 * skip the dashboard for a stretch.
 *
 * Why we need this: any future analytics / reports that filter on
 * `auto_ended_at IS NOT NULL` (e.g. completion-rate reporting,
 * cohort-by-month event-end stats) need the audit trail to be complete,
 * not "complete only for events the operator happened to view." Lazy
 * fire-and-forget remains the source of truth for fresh events; this
 * sweep catches the long tail.
 *
 * Targets:
 *   - event_date < today
 *   - end_time IS NOT NULL          (no end_time means "open-ended" —
 *                                    don't stamp; operator will close it)
 *   - auto_ended_at IS NULL         (don't double-stamp)
 *   - booked = true                 (unbooked events have no audit
 *                                    semantic for "ended")
 *   - cancellation_reason IS NULL   (cancellations carry their own
 *                                    end-state; don't stamp those)
 *
 * Schedule: every 15 minutes (`*\/15 * * * *`). Cheap query — uses the
 * existing index on event_date.
 *
 * Auth via CRON_SECRET — same pattern as the other cron routes.
 *
 * Stamping strategy: we use `now()` rather than reconstructing the
 * actual end-time-in-operator-tz. The day-of-event-state code reads
 * auto_ended_at as a boolean flag (`if (e.auto_ended_at) return false`),
 * so a rough timestamp is sufficient and we avoid per-row timezone
 * lookups in a sweep query. If a future feature needs the precise
 * end-instant we'd reconstruct it from event_date + end_time +
 * profiles.timezone at that point.
 */

export async function GET(req: NextRequest) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Use yesterday's UTC date as the cutoff. event_date is a DATE column
  // (no tz), and using "today" risks racing against an event that ends
  // late evening in operator's tz where the lazy-write would be more
  // precise. Yesterday is comfortably past for every US zone.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const cutoffDate = yesterday.toISOString().slice(0, 10);

  // Pre-count for the response payload — same pattern as
  // login-events-cleanup.
  const { count: priorCount } = await service
    .from("events")
    .select("id", { count: "exact", head: true })
    .lte("event_date", cutoffDate)
    .not("end_time", "is", null)
    .is("auto_ended_at", null)
    .eq("booked", true)
    .is("cancellation_reason", null);

  const { error } = await service
    .from("events")
    .update({ auto_ended_at: new Date().toISOString() })
    .lte("event_date", cutoffDate)
    .not("end_time", "is", null)
    .is("auto_ended_at", null)
    .eq("booked", true)
    .is("cancellation_reason", null);

  if (error) {
    return NextResponse.json(
      { error: error.message, cutoff: cutoffDate },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    stamped: priorCount ?? 0,
    cutoff_date: cutoffDate,
  });
}
