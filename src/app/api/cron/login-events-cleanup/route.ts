import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/login-events-cleanup
 *
 * Prunes profile_login_events rows older than 90 days. Runs weekly
 * (Sunday 03:00 UTC). The table is for security signal — new-device
 * email lookback only goes back 30 days, so 90 days of retention is
 * generous slack while keeping the table bounded.
 *
 * Auth via CRON_SECRET — same pattern as the other cron routes.
 */

const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  // Use head:true so the count is fetched without pulling rows. We
  // record it pre-delete so the response is honest about how many
  // rows the cron actually pruned.
  const { count: priorCount } = await service
    .from("profile_login_events")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso);

  const { error } = await service
    .from("profile_login_events")
    .delete()
    .lt("created_at", cutoffIso);

  if (error) {
    return NextResponse.json(
      { error: error.message, cutoff: cutoffIso },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: priorCount ?? 0,
    cutoff: cutoffIso,
    retention_days: RETENTION_DAYS,
  });
}
