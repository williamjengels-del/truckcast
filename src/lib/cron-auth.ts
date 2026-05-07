import { NextResponse, type NextRequest } from "next/server";

/**
 * Cron-route auth gate. Returns a NextResponse to short-circuit with
 * 401/500, or null to allow the route to proceed.
 *
 * Production posture: fail closed. If CRON_SECRET is unset in
 * production, we 500 — better to break the cron than to silently
 * leave it open. Vercel cron schedules retry, so a misconfiguration
 * surfaces as failed jobs in the dashboard rather than as an
 * exfiltration vector.
 *
 * Dev posture: if CRON_SECRET is unset locally, allow through. This
 * is convenient for `curl localhost:3000/api/cron/...` testing
 * without faffing with env files.
 *
 * Pre-2026-05-06 each cron route inlined the same gate, but with
 * `if (process.env.CRON_SECRET && authHeader !== ...)` — which
 * silently allowed all callers when the env var was absent. That
 * was production-unsafe; this helper exists so the policy lives in
 * one place and can't drift across routes.
 */
export function assertCronSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 }
      );
    }
    return null;
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
