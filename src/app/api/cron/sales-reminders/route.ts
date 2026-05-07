import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendSalesReminderEmail } from "@/lib/email";
import { assertCronSecret } from "@/lib/cron-auth";

/**
 * POST /api/cron/sales-reminders
 *
 * Sends a once-per-event email reminder when a booked event passes without
 * sales being logged. Runs daily at 11 AM UTC.
 *
 * Logic:
 * - Finds booked events that ended 1–3 days ago with no net_sales
 * - Excludes pre-settled fee types (organizer pays flat fee, no sales to log)
 * - Groups by user, sends one email per user listing all unlogged events
 * - Capped at 5 events per email to keep it scannable
 *
 * TODO(Phase 8.2+): fire push notification in parallel with the email so
 * operators who have push enabled get the reminder on their phone too.
 * Call POST /api/push/send with { user_id, payload: { title: "N events
 * need sales logged", body: "...", url: "/dashboard/events?tab=needs_attention&chips=missing-sales" } }
 * after the sendSalesReminderEmail call. Fire-and-forget; don't fail the
 * email send on push errors.
 */

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

  // Date window: 1-3 days ago (recent enough to remember the event)
  const today = new Date();
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(today.getDate() - 3);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const fromDate = threeDaysAgo.toISOString().split("T")[0];
  const toDate = yesterday.toISOString().split("T")[0];

  // Fetch unlogged events in the window
  const { data: rawEvents, error } = await service
    .from("events")
    .select("id, user_id, event_name, event_date, event_mode, invoice_revenue")
    .eq("booked", true)
    .neq("fee_type", "pre_settled")
    .gte("event_date", fromDate)
    .lte("event_date", toDate)
    .or("net_sales.is.null,net_sales.eq.0");

  if (error) {
    console.error("[sales-reminders] DB error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Exclude catering events that have invoice revenue logged — those are complete
  const events = (rawEvents ?? []).filter(
    (e) => !(e.event_mode === "catering" && (e.invoice_revenue ?? 0) > 0)
  );

  if (events.length === 0) {
    return NextResponse.json({ sent: 0, reason: "no_unlogged_events" });
  }

  // Group events by user_id
  const byUser = new Map<string, typeof events>();
  for (const ev of events) {
    const list = byUser.get(ev.user_id) ?? [];
    list.push(ev);
    byUser.set(ev.user_id, list);
  }

  // Fetch email addresses for affected users
  const userIds = [...byUser.keys()];
  const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  for (const u of authData?.users ?? []) {
    if (userIds.includes(u.id) && u.email) emailMap.set(u.id, u.email);
  }

  // Fetch business names + email preferences for affected users
  const { data: profiles } = await service
    .from("profiles")
    .select("id, business_name, email_reminders_enabled")
    .in("id", userIds);
  const nameMap = new Map<string, string>();
  const remindersEnabledMap = new Map<string, boolean>();
  for (const p of profiles ?? []) {
    nameMap.set(p.id, p.business_name ?? "");
    // Treat null as true (default) — only skip if explicitly false
    remindersEnabledMap.set(p.id, p.email_reminders_enabled !== false);
  }

  const results: { userId: string; status: string }[] = [];

  for (const [userId, userEvents] of byUser) {
    const email = emailMap.get(userId);
    if (!email) {
      results.push({ userId, status: "no_email" });
      continue;
    }

    // Skip users who opted out of reminders
    if (remindersEnabledMap.get(userId) === false) {
      results.push({ userId, status: "opted_out" });
      continue;
    }

    const businessName = nameMap.get(userId) ?? "";
    // Cap at 5 most recent events to keep email scannable
    const topEvents = userEvents
      .sort((a, b) => b.event_date.localeCompare(a.event_date))
      .slice(0, 5)
      .map((e) => ({ event_name: e.event_name, event_date: e.event_date }));

    try {
      await sendSalesReminderEmail(email, businessName, topEvents);
      results.push({ userId, status: "sent" });
    } catch (err) {
      console.error(`[sales-reminders] Failed for ${email}:`, err);
      results.push({ userId, status: "error" });
    }
  }

  console.log("[sales-reminders] Done:", results);
  return NextResponse.json({ sent: results.filter((r) => r.status === "sent").length, results });
}
