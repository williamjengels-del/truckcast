import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { sendWeeklyDigestEmail, type WeeklyDigestPayload } from "@/lib/email";

/**
 * GET /api/admin/cron/weekly-digest/preview
 *
 * Admin-only diagnostic endpoint that runs the weekly-digest cron's
 * per-user computation for one operator and returns the full result as
 * JSON. Use this to debug "why didn't operator X get a digest" without
 * waiting for the next Monday cron firing.
 *
 * Query params:
 *   userId  — operator to preview (defaults to the requesting admin)
 *   send    — if "true", actually fire sendWeeklyDigestEmail in
 *             addition to returning the diagnostic. Default: false
 *             (preview-only, no side effects).
 *
 * Returns:
 *   {
 *     profile: { tier, email_reminders_enabled, has_email, ... },
 *     dateRange: { lastMondayStr, lastSundayStr, weekRangeLabel },
 *     metrics: { eventsRun, totalRevenue, bestDayCopy, ... },
 *     wouldSkip: boolean,
 *     skipReason: string | null,
 *     payload: WeeklyDigestPayload | null,  // null if skipped
 *     sent: boolean,                        // true only if send=true AND not skipped
 *   }
 *
 * Why this exists: pre-fix, the operator had never received a weekly
 * digest. Cron runs Mon 13:00 UTC; failure modes are silent because:
 *   - sendWeeklyDigestEmail no-ops if RESEND_API_KEY missing
 *   - The cron's try/catch swallows send errors
 *   - The "empty week skip" silently excludes operators with zero
 *     last-week activity AND zero upcoming AND zero unlogged
 *   - email_reminders_enabled = false silently excludes via filter
 *
 * Now: hit this endpoint, see exactly which path you hit, fix the
 * root cause without iterating cron schedules.
 */

const FORECAST_IN_RANGE_PCT = 0.20;
const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface EventRow {
  user_id: string;
  event_date: string;
  net_sales: number | null;
  invoice_revenue: number | null;
  forecast_sales: number | null;
  booked: boolean;
  cancellation_reason: string | null;
  anomaly_flag: string | null;
  event_mode: string | null;
}

function eventRevenue(e: EventRow): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
}

function hasRevenue(e: EventRow): boolean {
  return (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0);
}

function startOfWeekUTC(d: Date): Date {
  const out = new Date(d);
  const day = out.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  out.setUTCDate(out.getUTCDate() + diff);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export async function GET(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const targetUserId = url.searchParams.get("userId") ?? admin.id;
  const shouldSend = url.searchParams.get("send") === "true";

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Step 1: profile state
  const { data: profile } = await service
    .from("profiles")
    .select("id, business_name, subscription_tier, email_reminders_enabled")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found", userId: targetUserId }, { status: 404 });
  }

  const { data: authUser } = await service.auth.admin.getUserById(targetUserId);
  const email = authUser?.user?.email ?? null;

  // Step 2: eligibility check
  const tierEligible =
    profile.subscription_tier === "pro" || profile.subscription_tier === "premium";
  const remindersEnabled = profile.email_reminders_enabled !== false; // null = enabled
  const eligibilityIssues: string[] = [];
  if (!tierEligible) eligibilityIssues.push(`tier=${profile.subscription_tier} (need pro/premium)`);
  if (!remindersEnabled) eligibilityIssues.push("email_reminders_enabled=false");
  if (!email) eligibilityIssues.push("no email on auth user");

  // Step 3: date range
  const now = new Date();
  const thisMonday = startOfWeekUTC(now);
  const lastSunday = new Date(thisMonday);
  lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 6);
  const baselineStart = new Date(lastMonday);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 7 * 8);
  const nextSunday = new Date(thisMonday);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + 6);

  const lastMondayStr = lastMonday.toISOString().slice(0, 10);
  const lastSundayStr = lastSunday.toISOString().slice(0, 10);
  const baselineStartStr = baselineStart.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);
  const nextSundayStr = nextSunday.toISOString().slice(0, 10);
  const weekRangeLabel = `${dateLabel(lastMonday)} – ${dateLabel(lastSunday)}`;

  // Step 4: pull events for this user
  const { data: userEventsRaw } = await service
    .from("events")
    .select("user_id, event_date, net_sales, invoice_revenue, forecast_sales, booked, cancellation_reason, anomaly_flag, event_mode")
    .eq("user_id", targetUserId)
    .gte("event_date", baselineStartStr)
    .lte("event_date", nextSundayStr);

  const userEvents = (userEventsRaw ?? []) as EventRow[];

  // Step 5: compute metrics — same logic as the cron
  const lastWeek = userEvents.filter(
    (e) =>
      e.event_date >= lastMondayStr &&
      e.event_date <= lastSundayStr &&
      e.booked &&
      !e.cancellation_reason &&
      e.anomaly_flag !== "disrupted"
  );
  const eventsRun = lastWeek.length;
  const totalRevenue = lastWeek.reduce((sum, e) => sum + eventRevenue(e), 0);

  let bestDayCopy: string | null = null;
  if (lastWeek.length >= 2) {
    const baseline = userEvents.filter(
      (e) =>
        e.event_date >= baselineStartStr &&
        e.event_date < lastMondayStr &&
        e.booked &&
        !e.cancellation_reason &&
        e.anomaly_flag !== "disrupted" &&
        hasRevenue(e)
    );
    if (baseline.length >= 4) {
      const baselineAvg =
        baseline.reduce((sum, e) => sum + eventRevenue(e), 0) / baseline.length;
      const dayTotals: Record<number, number> = {};
      for (const e of lastWeek) {
        if (!hasRevenue(e)) continue;
        const dow = new Date(e.event_date + "T00:00:00").getDay();
        dayTotals[dow] = (dayTotals[dow] ?? 0) + eventRevenue(e);
      }
      const sortedDays = Object.entries(dayTotals).sort((a, b) => b[1] - a[1]);
      if (sortedDays.length > 0 && baselineAvg > 0) {
        const [bestDow, bestRevenue] = sortedDays[0];
        const lift = Math.round((bestRevenue / baselineAvg - 1) * 100);
        if (Math.abs(lift) >= 10) {
          const direction = lift > 0 ? "above" : "below";
          bestDayCopy = `${DOW_LABELS[parseInt(bestDow)]} came in ${Math.abs(lift)}% ${direction} your typical event.`;
        }
      }
    }
  }

  let forecastAccuracyPct: number | null = null;
  const forecasted = lastWeek.filter(
    (e) => e.forecast_sales !== null && e.forecast_sales > 0 && hasRevenue(e)
  );
  if (forecasted.length >= 2) {
    const inRange = forecasted.filter((e) => {
      const actual = eventRevenue(e);
      const fc = e.forecast_sales!;
      return Math.abs(actual - fc) / fc <= FORECAST_IN_RANGE_PCT;
    }).length;
    forecastAccuracyPct = Math.round((inRange / forecasted.length) * 100);
  }

  const unloggedCount = userEvents.filter(
    (e) =>
      e.event_date < todayStr &&
      e.booked &&
      !e.cancellation_reason &&
      e.anomaly_flag !== "disrupted" &&
      e.net_sales === null &&
      !(e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0)
  ).length;

  const upcomingNextWeek = userEvents.filter(
    (e) =>
      e.event_date >= thisMonday.toISOString().slice(0, 10) &&
      e.event_date <= nextSundayStr &&
      e.booked &&
      !e.cancellation_reason
  ).length;

  // Step 6: skip determination — same logic as the cron
  let wouldSkip = false;
  let skipReason: string | null = null;

  if (eligibilityIssues.length > 0) {
    wouldSkip = true;
    skipReason = `Eligibility: ${eligibilityIssues.join(", ")}`;
  } else if (eventsRun === 0 && upcomingNextWeek === 0 && unloggedCount === 0) {
    wouldSkip = true;
    skipReason = "Empty-week skip (no last-week activity, no upcoming, no unlogged backlog)";
  }

  const payload: WeeklyDigestPayload | null = wouldSkip || !email
    ? null
    : {
        to: email,
        businessName: profile.business_name ?? "",
        weekRangeLabel,
        eventsRun,
        totalRevenue,
        bestDayCopy,
        forecastAccuracyPct,
        unloggedCount,
        upcomingNextWeek,
      };

  // Step 7: optional actual send
  let sent = false;
  let sendError: string | null = null;
  if (shouldSend && payload) {
    try {
      await sendWeeklyDigestEmail(payload);
      sent = true;
    } catch (e) {
      sendError = e instanceof Error ? e.message : "Unknown send error";
    }
  }

  // Step 8: env diagnostics — surface common silent-failure causes
  const env = {
    RESEND_API_KEY_set: !!process.env.RESEND_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET_set: !!process.env.CRON_SECRET,
  };

  return NextResponse.json({
    userId: targetUserId,
    profile: {
      business_name: profile.business_name,
      subscription_tier: profile.subscription_tier,
      email_reminders_enabled: profile.email_reminders_enabled,
      has_email: !!email,
      email,
    },
    eligibility: {
      tierEligible,
      remindersEnabled,
      hasEmail: !!email,
      issues: eligibilityIssues,
    },
    dateRange: {
      lastMondayStr,
      lastSundayStr,
      weekRangeLabel,
      todayStr,
      nextSundayStr,
      baselineStartStr,
    },
    metrics: {
      eventsRun,
      totalRevenue,
      bestDayCopy,
      forecastAccuracyPct,
      unloggedCount,
      upcomingNextWeek,
      eventsInBaselineWindow: userEvents.length,
    },
    wouldSkip,
    skipReason,
    payload,
    sent,
    sendError,
    env,
  });
}
