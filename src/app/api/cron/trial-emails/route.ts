import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  sendTrialExpiryEmail,
  sendTrialExpiredEmail,
} from "@/lib/email";

// Vercel cron — runs daily at 10:00 AM UTC
// Secured by CRON_SECRET header set in vercel.json

const TRIAL_DAYS = 14;

// Days before expiry to send warning emails
const WARN_AT_DAYS = [7, 3, 1];

// Match middleware.ts — hard gate only fires on/after this date
const HARD_GATE_DATE = new Date("2026-05-01T00:00:00Z");

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export async function GET(req: NextRequest) {
  // Verify this is a legitimate Vercel cron request
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

  // Fetch all starter-tier users who haven't upgraded (no stripe_subscription_id)
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, business_name, created_at, trial_extended_until")
    .eq("subscription_tier", "starter")
    .is("stripe_subscription_id", null);

  if (error) {
    console.error("[trial-emails] Error fetching profiles:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch emails from auth
  const { data: authData } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  const emailMap: Record<string, string> = {};
  for (const u of authData?.users ?? []) {
    emailMap[u.id] = u.email ?? "";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = {
    warnings: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
  };

  for (const profile of profiles ?? []) {
    const email = emailMap[profile.id];
    if (!email) { results.skipped++; continue; }

    // Determine effective trial end — use extended date if set and in future, otherwise created_at + TRIAL_DAYS
    let trialEndDate: Date;
    if (
      profile.trial_extended_until &&
      new Date(profile.trial_extended_until) > today
    ) {
      trialEndDate = new Date(profile.trial_extended_until);
      trialEndDate.setHours(0, 0, 0, 0);
    } else {
      const signupDate = new Date(profile.created_at);
      signupDate.setHours(0, 0, 0, 0);
      trialEndDate = new Date(signupDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    }

    const daysLeft = daysBetween(today, trialEndDate);
    const daysSinceExpiry = daysLeft < 0 ? Math.abs(daysLeft) : 0;

    try {
      if (daysLeft < 0) {
        // Trial expired — only send on day 1 after expiry to avoid spam
        if (daysSinceExpiry === 1) {
          const gracePeriodActive = today < HARD_GATE_DATE;
          await sendTrialExpiredEmail(email, profile.business_name ?? "", gracePeriodActive);
          results.expired++;
        } else {
          results.skipped++;
        }
      } else if (WARN_AT_DAYS.includes(daysLeft)) {
        await sendTrialExpiryEmail(
          email,
          profile.business_name ?? "",
          daysLeft
        );
        results.warnings++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      console.error(`[trial-emails] Failed for ${email}:`, err);
      results.errors++;
    }
  }

  console.log("[trial-emails] Done:", results);
  return NextResponse.json({ ok: true, ...results });
}
