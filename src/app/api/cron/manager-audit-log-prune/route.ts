import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/manager-audit-log-prune
 *
 * Prunes manager_audit_log rows older than 365 days. Runs weekly
 * (Sunday 04:00 UTC, after the platform-registry rebuild and the
 * other early-Sunday maintenance jobs).
 *
 * Retention chosen 2026-05-14 with operator: 365 days catches a full
 * annual cycle (food-truck post-mortems, tax prep, year-over-year
 * reconciliation) and gives a clean "we retain a year" story. The
 * Activity UI surface defaults to last-90-days for readability;
 * "show all" reaches the full year. At 30-op scale with managers
 * active, this table tops out around ~55 MB/year — sub-1% of the
 * Supabase Pro 8 GB ceiling, so retention can extend later if
 * forensic needs grow.
 *
 * Auth via CRON_SECRET — same pattern as the other cron routes.
 */

const RETENTION_DAYS = 365;

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

  // Pre-count for an honest deleted count in the response.
  const { count: priorCount } = await service
    .from("manager_audit_log")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso);

  const { error } = await service
    .from("manager_audit_log")
    .delete()
    .lt("created_at", cutoffIso);

  if (error) {
    // Tolerate 42P01 (relation does not exist) so this cron can deploy
    // ahead of the migration paste. Other errors surface as 500 so the
    // Vercel cron dashboard flags them.
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({
        ok: true,
        skipped: "table does not exist yet",
        cutoff: cutoffIso,
        retention_days: RETENTION_DAYS,
      });
    }
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
