import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendOnboardingNudgeEmail } from "@/lib/email";

/**
 * GET /api/cron/onboarding-nudge
 *
 * Sends a single follow-up email to users who signed up 20–48 hours ago
 * but still haven't completed onboarding. Runs every few hours.
 *
 * Logic:
 * - Find auth users created 20–48h ago
 * - Cross-reference with profiles where onboarding_completed = false
 * - Send one nudge email per user (one-time — window is narrow enough to avoid repeat)
 */

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: "No RESEND_API_KEY" });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();
  const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48h ago
  const windowEnd = new Date(now.getTime() - 20 * 60 * 60 * 1000);   // 20h ago

  // Find profiles that are incomplete and were created in the nudge window
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, business_name, created_at")
    .eq("onboarding_completed", false)
    .gte("created_at", windowStart.toISOString())
    .lte("created_at", windowEnd.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ sent: 0, message: "No users in nudge window" });
  }

  // Get auth emails for these users
  const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
  const emailMap: Record<string, string> = {};
  for (const u of authData?.users ?? []) {
    emailMap[u.id] = u.email ?? "";
  }

  let sent = 0;
  const errors: string[] = [];

  for (const profile of profiles) {
    const email = emailMap[profile.id];
    if (!email) continue;

    try {
      await sendOnboardingNudgeEmail(email);
      sent++;
    } catch (err) {
      errors.push(`${email}: ${String(err)}`);
    }
  }

  return NextResponse.json({ sent, errors: errors.length ? errors : undefined });
}
