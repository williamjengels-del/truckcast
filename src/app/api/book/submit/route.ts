import { after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendPushToSubscriptions, type PushSubscriptionRow } from "@/lib/push";
import { sendBookingInquiryEmail } from "@/lib/email";
import { ATTENDANCE_RANGES } from "@/lib/database.types";
import { EVENT_TYPES } from "@/lib/constants";

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);
const ATTENDANCE_RANGE_SET = new Set<string>(ATTENDANCE_RANGES);

// POST /api/book/submit
//
// Public (no auth) — this is the booking-request intake. The form on
// /book/[userId] POSTs here. Uses the service role to insert past RLS
// (booking_requests doesn't allow anonymous inserts via anon key) and
// fires a push notification to the operator after successful insert.
//
// The push trigger runs inside Next.js's `after()` hook so it survives
// past the 200 response. Without `after()`, Vercel freezes the Lambda
// container within ~50ms of returning, cancelling the web-push HTTPS
// request to APNs mid-flight and silently dropping the notification.
export async function POST(req: Request) {
  let body: {
    truck_user_id?: string;
    requester_name?: string;
    requester_email?: string;
    requester_phone?: string | null;
    event_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    event_type?: string | null;
    location?: string | null;
    attendance_range?: string | null;
    // Deprecated — legacy integer column. New submissions ignore this.
    estimated_attendance?: number | null;
    message?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const truck_user_id = body.truck_user_id;
  const requester_name = body.requester_name?.trim();
  const requester_email = body.requester_email?.trim();
  const event_date = body.event_date || null;
  const event_type = body.event_type?.trim() || null;
  const location = body.location?.trim() || null;
  const attendance_range = body.attendance_range?.trim() || null;

  if (!truck_user_id || !requester_name || !requester_email) {
    return Response.json(
      { error: "Missing required fields: name, email, truck." },
      { status: 400 }
    );
  }
  if (!event_date) {
    return Response.json({ error: "Event date is required." }, { status: 400 });
  }
  if (!event_type || !EVENT_TYPE_SET.has(event_type)) {
    return Response.json({ error: "Event type is required." }, { status: 400 });
  }
  if (!location) {
    return Response.json({ error: "Event location is required." }, { status: 400 });
  }
  if (!attendance_range || !ATTENDANCE_RANGE_SET.has(attendance_range)) {
    return Response.json({ error: "Expected attendance is required." }, { status: 400 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: inserted, error: insertError } = await service
    .from("booking_requests")
    .insert({
      truck_user_id,
      requester_name,
      requester_email,
      requester_phone: body.requester_phone?.trim() || null,
      event_date,
      start_time: body.start_time || null,
      end_time: body.end_time || null,
      event_type,
      location,
      attendance_range,
      // Legacy INTEGER column — new form doesn't collect it, leave null.
      estimated_attendance: null,
      message: body.message?.trim() || null,
    })
    .select("id, event_date")
    .single();

  if (insertError || !inserted) {
    return Response.json(
      { error: insertError?.message ?? "Failed to create booking request" },
      { status: 500 }
    );
  }

  // Post-response notifications (push + email). `after()` keeps the Lambda
  // alive until the callbacks resolve — same response latency for the
  // booker, but the web-push HTTPS call and the Resend send actually
  // complete. Both run in parallel; neither is awaited by the other so
  // one failing doesn't block the other.
  after(() =>
    notifyOperatorOfBooking(service, truck_user_id, {
      bookingId: inserted.id as string,
      requesterName: requester_name,
      eventDate: (inserted.event_date as string | null) ?? null,
      location,
    }).catch((err) => {
      console.error("[push] book/submit notification failed:", err);
    })
  );

  after(() =>
    emailOperatorOfBooking(service, truck_user_id, {
      requesterName: requester_name,
      requesterEmail: requester_email,
      requesterPhone: body.requester_phone?.trim() || null,
      eventDate: (inserted.event_date as string | null) ?? null,
      startTime: body.start_time || null,
      endTime: body.end_time || null,
      eventType: event_type,
      location,
      attendanceRange: attendance_range,
      message: body.message?.trim() || null,
    }).catch((err) => {
      console.error("[email] book/submit notification failed:", err);
    })
  );

  return Response.json({ ok: true });
}

async function notifyOperatorOfBooking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  operatorUserId: string,
  booking: {
    bookingId: string;
    requesterName: string;
    eventDate: string | null;
    location: string;
  }
) {
  const { data: subs, error } = await service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", operatorUserId);

  if (error) {
    console.error(`[push] book/submit subscription lookup failed for ${operatorUserId}:`, error.message);
    return;
  }
  if (!subs || subs.length === 0) {
    console.log(`[push] book/submit no subscriptions for ${operatorUserId} — skipping`);
    return;
  }

  const dateText = booking.eventDate
    ? new Date(booking.eventDate + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  // Payload target: "[name] wants to book you for [date] at [location]",
  // under 100 chars to avoid iOS truncation. Location is triage-critical,
  // so if we go over budget we drop the date first.
  const withDate =
    dateText
      ? `${booking.requesterName} wants to book you for ${dateText} at ${booking.location}`
      : `${booking.requesterName} wants to book you at ${booking.location}`;
  const body = withDate.length > 100
    ? `${booking.requesterName} wants to book you at ${booking.location}`
    : withDate;

  const result = await sendPushToSubscriptions(subs as PushSubscriptionRow[], {
    title: "New booking inquiry",
    body,
    url: "/dashboard/bookings",
    tag: `booking-${booking.bookingId}`,
  });

  console.log(
    `[push] book/submit user=${operatorUserId} subs=${subs.length} delivered=${result.delivered} failed=${result.failed} cleaned=${result.invalidEndpoints.length}`
  );

  // Clean up dead endpoints so the next push doesn't retry them.
  if (result.invalidEndpoints.length > 0) {
    await service
      .from("push_subscriptions")
      .delete()
      .in("endpoint", result.invalidEndpoints);
  }

  // Touch last_used_at for surviving subs — gives visibility into which
  // devices are actually reachable at send time.
  const survivingEndpoints = (subs as PushSubscriptionRow[])
    .map((s) => s.endpoint)
    .filter((e) => !result.invalidEndpoints.includes(e));
  if (survivingEndpoints.length > 0) {
    await service
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .in("endpoint", survivingEndpoints);
  }
}

async function emailOperatorOfBooking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  operatorUserId: string,
  payload: {
    requesterName: string;
    requesterEmail: string;
    requesterPhone: string | null;
    eventDate: string | null;
    startTime: string | null;
    endTime: string | null;
    eventType: string;
    location: string;
    attendanceRange: string;
    message: string | null;
  }
) {
  // Operator email lives in auth.users (not profiles). Resolve via the
  // admin API with the service role. business_name is in profiles for
  // the greeting.
  const { data: userRow, error: userError } =
    await service.auth.admin.getUserById(operatorUserId);
  if (userError || !userRow?.user?.email) {
    console.error(
      `[email] book/submit operator lookup failed for ${operatorUserId}:`,
      userError?.message ?? "no email on user"
    );
    return;
  }
  const operatorEmail = userRow.user.email as string;

  const { data: profile } = await service
    .from("profiles")
    .select("business_name")
    .eq("id", operatorUserId)
    .single();
  const businessName = (profile?.business_name as string) ?? "";

  await sendBookingInquiryEmail(operatorEmail, {
    businessName,
    ...payload,
  });

  console.log(
    `[email] book/submit sent inquiry notification to operator=${operatorUserId} (business="${businessName}")`
  );
}
