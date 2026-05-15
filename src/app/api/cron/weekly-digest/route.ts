import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendWeeklyDigestEmail, type WeeklyDigestPayload } from "@/lib/email";
import { assertCronSecret } from "@/lib/cron-auth";
import { localDateInZone } from "@/lib/wallclock-tz";

/**
 * GET /api/cron/weekly-digest
 *
 * Sends a 1-paragraph "your week in review" email every Monday morning
 * to operators who:
 *   - Are on Pro or Premium tier (Starter is the always-free intro tier;
 *     digests would feel salesy as the only weekly touch)
 *   - Have email_reminders_enabled = true
 *   - Have an email address on the auth user
 *
 * Schedule: Monday 13:00 UTC = 8am Central (Wok-O timezone). Operators
 * elsewhere get it at their local Monday morning roughly.
 *
 * Per-operator content:
 *   - Last week's event count + total revenue
 *   - Best-day-of-week vs weekday-average comparison (when there's signal)
 *   - Forecast accuracy (last week's events with both forecast + actual,
 *     within ±20% counts as "in range")
 *   - Past-events-needing-sales-logged count
 *   - Booked-events-coming-next-week count
 *
 * Auth via CRON_SECRET — same pattern as the other cron routes.
 *
 * Why Pro/Premium gating: Starter operators get the welcome / nudge
 * sequence; weekly digests during a free phase feel pushy. Once they
 * upgrade, they're committing to the relationship and the digest is a
 * "we're working in the background for you" signal.
 */

interface ProfileRow {
  id: string;
  business_name: string | null;
  subscription_tier: "starter" | "pro" | "premium";
  email_reminders_enabled: boolean | null;
  timezone: string | null;
}

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

const FORECAST_IN_RANGE_PCT = 0.20; // ±20% counts as "in range" for digest accuracy
const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function eventRevenue(e: EventRow): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? (e.invoice_revenue ?? 0) : 0);
}

function hasRevenue(e: EventRow): boolean {
  return (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0);
}

function startOfWeekUTC(d: Date): Date {
  // Returns Monday 00:00 UTC of the week containing d.
  const out = new Date(d);
  const day = out.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  out.setUTCDate(out.getUTCDate() + diff);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export async function GET(req: NextRequest) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Compute the digest week: last full Monday-Sunday relative to today.
  // If the cron fires Monday morning, "last week" = the week that just
  // ended Sunday night.
  const now = new Date();
  const thisMonday = startOfWeekUTC(now);
  const lastSunday = new Date(thisMonday);
  lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
  const lastMonday = new Date(lastSunday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 6);

  const lastMondayStr = lastMonday.toISOString().slice(0, 10);
  const lastSundayStr = lastSunday.toISOString().slice(0, 10);
  const weekRangeLabel = `${dateLabel(lastMonday)} – ${dateLabel(lastSunday)}`;

  // Eligible profiles: Pro or Premium with reminders on. Pull
  // `timezone` so the per-profile loop below can derive each operator's
  // local "today" for the unlogged-backlog cutoff. UTC's today drifts
  // up to 24 hours from a Honolulu operator's today, which silently
  // mis-classifies same-day events as backlog (or vice-versa).
  const { data: profiles } = await service
    .from("profiles")
    .select("id, business_name, subscription_tier, email_reminders_enabled, timezone")
    .in("subscription_tier", ["pro", "premium"])
    .or("email_reminders_enabled.is.null,email_reminders_enabled.eq.true");

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, eligible: 0, week: weekRangeLabel });
  }

  // Pull last-12-weeks of events for each user in one shot. We need
  // last week's events + a baseline window for the best-day comparison.
  const baselineStart = new Date(lastMonday);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 7 * 8); // 8 weeks before last week
  const baselineStartStr = baselineStart.toISOString().slice(0, 10);

  const userIds = (profiles as ProfileRow[]).map((p) => p.id);
  // Note: per-profile localTodayStr is computed inside the loop below
  // using `profile.timezone` — UTC's today drifts up to 24h from a non-
  // CT operator's today, which mis-classifies same-day events as
  // backlog. Buzzy Bites (Toledo) was the surfacing case.
  const nextSunday = new Date(thisMonday);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + 6);
  const nextSundayStr = nextSunday.toISOString().slice(0, 10);

  const { data: allEvents } = await service
    .from("events")
    .select("user_id, event_date, net_sales, invoice_revenue, forecast_sales, booked, cancellation_reason, anomaly_flag, event_mode")
    .in("user_id", userIds)
    .gte("event_date", baselineStartStr)
    .lte("event_date", nextSundayStr);

  if (!allEvents) {
    return NextResponse.json({ ok: true, sent: 0, eligible: profiles.length, week: weekRangeLabel });
  }

  // Group events by user_id for per-operator computation.
  const eventsByUser = new Map<string, EventRow[]>();
  for (const e of allEvents as EventRow[]) {
    if (!eventsByUser.has(e.user_id)) eventsByUser.set(e.user_id, []);
    eventsByUser.get(e.user_id)!.push(e);
  }

  let sent = 0;
  let skipped = 0;
  // Track per-user outcomes so the cron's response payload is
  // diagnostic instead of opaque. Vercel cron logs surface this on
  // every run; admin can tail to confirm send behavior is correct.
  const outcomes: Array<{ userId: string; email?: string; result: string }> = [];
  for (const profile of profiles as ProfileRow[]) {
    const userEvents = eventsByUser.get(profile.id) ?? [];

    // Operator's local today — for the unlogged-backlog cutoff below.
    // Falls back to UTC when timezone is missing or unrecognized (same
    // semantics as before the per-tz fix). CT operators get the same
    // result either way for most of the day; PT/ET operators get the
    // off-by-one corrected.
    const todayStr = localDateInZone(profile.timezone ?? "UTC");

    // Resolve email from auth — RLS doesn't matter, we're service role.
    const { data: authUser } = await service.auth.admin.getUserById(profile.id);
    const email = authUser?.user?.email;
    if (!email) {
      skipped += 1;
      outcomes.push({ userId: profile.id, result: "skipped: no email on auth user" });
      continue;
    }

    // Last-week aggregates
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

    // Best-day comparison: best-revenue DOW last week vs that operator's
    // 8-week baseline weekday average. Skip if no signal.
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
        // Find best last-week day by event-revenue
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

    // Forecast accuracy on last week's events
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

    // Unlogged past events (any past event without sales)
    const unloggedCount = userEvents.filter(
      (e) =>
        e.event_date < todayStr &&
        e.booked &&
        !e.cancellation_reason &&
        e.anomaly_flag !== "disrupted" &&
        e.net_sales === null &&
        !(e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0)
    ).length;

    // Upcoming next week
    const upcomingNextWeek = userEvents.filter(
      (e) =>
        e.event_date >= thisMonday.toISOString().slice(0, 10) &&
        e.event_date <= nextSundayStr &&
        e.booked &&
        !e.cancellation_reason
    ).length;

    // Don't send a digest to operators who had ZERO last-week activity AND
    // ZERO upcoming events AND ZERO unlogged backlog. Sending an empty
    // "you did nothing, plan nothing, log nothing" email is salesy noise,
    // not a service signal. Skip them this week.
    if (eventsRun === 0 && upcomingNextWeek === 0 && unloggedCount === 0) {
      skipped += 1;
      outcomes.push({
        userId: profile.id,
        email,
        result: "skipped: empty week (no last-week activity, no upcoming, no unlogged)",
      });
      continue;
    }

    const payload: WeeklyDigestPayload = {
      to: email,
      userId: profile.id,
      businessName: profile.business_name ?? "",
      weekRangeLabel,
      eventsRun,
      totalRevenue,
      bestDayCopy,
      forecastAccuracyPct,
      unloggedCount,
      upcomingNextWeek,
    };

    try {
      await sendWeeklyDigestEmail(payload);
      sent += 1;
      outcomes.push({ userId: profile.id, email, result: "sent" });
    } catch (err) {
      skipped += 1;
      const message = err instanceof Error ? err.message : "unknown send error";
      outcomes.push({
        userId: profile.id,
        email,
        result: `skipped: send error — ${message}`,
      });
      // Log to console so Vercel logs surface the actual failure.
      // Pre-fix the catch block silently swallowed errors — operators
      // never received digests for unknown reasons (e.g. RESEND_API_KEY
      // missing → silent no-op in sendWeeklyDigestEmail).
      console.error(
        `[weekly-digest] send failed for ${profile.id} (${email}):`,
        message
      );
    }
  }

  // Single console.log summary at the end so Vercel logs always show
  // the result even when the response body is rotated out.
  console.log(
    `[weekly-digest] week=${weekRangeLabel} eligible=${profiles.length} sent=${sent} skipped=${skipped}`
  );

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    eligible: profiles.length,
    week: weekRangeLabel,
    outcomes,
  });
}
