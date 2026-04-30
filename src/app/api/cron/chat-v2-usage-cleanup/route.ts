import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * GET /api/cron/chat-v2-usage-cleanup
 *
 * Prunes chat_v2_usage rows older than 90 days. Runs weekly
 * (Sunday 03:30 UTC, 30 minutes after the login-events sweeper to
 * avoid stacking long-running queries on the same minute).
 *
 * Why a sweeper:
 *   The current-month cap query naturally bounds the table per
 *   operator per month, but historical rows accumulate forever
 *   without a cleanup. 90 days is generous for any future audit /
 *   billing reconciliation while keeping the table from growing
 *   unbounded.
 *
 * Auth via CRON_SECRET — same pattern as the other cron routes.
 */

const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  // count: "exact", head: true so we can report rows-pruned without
  // pulling them. Same idiom as the login-events-cleanup cron.
  const { count: priorCount } = await service
    .from("chat_v2_usage")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso);

  const { error } = await service
    .from("chat_v2_usage")
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
