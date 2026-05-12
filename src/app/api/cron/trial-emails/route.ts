import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  sendTrialExpiryEmail,
  sendTrialExpiredEmail,
} from "@/lib/email";
import { assertCronSecret } from "@/lib/cron-auth";
import { localDateInZone } from "@/lib/wallclock-tz";

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
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: "No RESEND_API_KEY" });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch all starter-tier users who haven't upgraded. `timezone` is
  // pulled so the per-profile loop below derives daysLeft against the
  // operator's local midnight, not UTC. For a PT operator the cron
  // fires at 10 UTC = 2-3 AM their time; UTC's "today" is already
  // their tomorrow, which shifts the trial-end boundary and silently
  // pushes the warning/expired emails by a day.
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, business_name, created_at, trial_extended_until, timezone")
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

  const results = {
    warnings: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
  };

  // Parse a YYYY-MM-DD string to a UTC-midnight Date so daysBetween
  // produces a stable integer regardless of process tz. Used to align
  // both `today` (in operator's zone) and `trialEndDate` (derived from
  // created_at in operator's zone) to a common axis for diffing.
  function parseDateString(s: string): Date {
    return new Date(s + "T00:00:00Z");
  }

  for (const profile of (profiles ?? []) as Array<{
    id: string;
    business_name: string | null;
    created_at: string;
    trial_extended_until: string | null;
    timezone: string | null;
  }>) {
    const email = emailMap[profile.id];
    if (!email) { results.skipped++; continue; }

    const tz = profile.timezone ?? "UTC";
    const localToday = parseDateString(localDateInZone(tz));

    // Determine effective trial end — extended date if set and still
    // in the future (operator's local frame), otherwise created_at + 14
    // days in the operator's zone. localDateInZone applied to the
    // signup instant gives the calendar date the operator saw when
    // they signed up, so signup_local + 14 days = expiration_local.
    // Convert the signup UTC instant to the operator's local YYYY-MM-DD
    // — that's the calendar date they saw when they signed up. Adding
    // TRIAL_DAYS in millis preserves the local-date semantics across
    // DST transitions (we never re-anchor to UTC midnight after).
    const signupLocalFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const signupLocalDate = parseDateString(
      signupLocalFmt.format(new Date(profile.created_at))
    );

    let trialEndDate: Date;
    if (profile.trial_extended_until) {
      const extended = parseDateString(
        profile.trial_extended_until.slice(0, 10)
      );
      trialEndDate =
        extended > localToday
          ? extended
          : new Date(signupLocalDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    } else {
      trialEndDate = new Date(
        signupLocalDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000
      );
    }

    const daysLeft = daysBetween(localToday, trialEndDate);
    const daysSinceExpiry = daysLeft < 0 ? Math.abs(daysLeft) : 0;

    try {
      if (daysLeft < 0) {
        // Trial expired — only send on day 1 after expiry to avoid spam
        if (daysSinceExpiry === 1) {
          // Grace-period gate stays in absolute UTC time — the
          // HARD_GATE_DATE is a platform-wide rollout boundary, not
          // a per-operator deadline. Mixing tz here would let a HI
          // operator escape the gate that an ET operator hit on the
          // same wall-clock second.
          const gracePeriodActive = new Date() < HARD_GATE_DATE;
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
