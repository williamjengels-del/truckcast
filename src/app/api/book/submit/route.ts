import { after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendPushToSubscriptions, type PushSubscriptionRow } from "@/lib/push";

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
    event_type?: string | null;
    estimated_attendance?: number | null;
    message?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    truck_user_id,
    requester_name,
    requester_email,
  } = body;

  if (!truck_user_id || !requester_name?.trim() || !requester_email?.trim()) {
    return Response.json(
      { error: "Missing required fields (truck_user_id, requester_name, requester_email)" },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: inserted, error: insertError } = await service
    .from("booking_requests")
    .insert({
      truck_user_id,
      requester_name: requester_name.trim(),
      requester_email: requester_email.trim(),
      requester_phone: body.requester_phone?.trim() || null,
      event_date: body.event_date || null,
      event_type: body.event_type || null,
      estimated_attendance: body.estimated_attendance ?? null,
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

  // Post-response push. `after()` keeps the Lambda alive until the
  // callback resolves — same response latency for the booker, but the
  // web-push HTTPS call actually completes.
  after(() =>
    notifyOperatorOfBooking(service, truck_user_id, {
      bookingId: inserted.id as string,
      requesterName: requester_name.trim(),
      eventDate: (inserted.event_date as string | null) ?? null,
    }).catch((err) => {
      console.error("[push] book/submit notification failed:", err);
    })
  );

  return Response.json({ ok: true });
}

async function notifyOperatorOfBooking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  operatorUserId: string,
  booking: { bookingId: string; requesterName: string; eventDate: string | null }
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
    : "an event";

  const result = await sendPushToSubscriptions(subs as PushSubscriptionRow[], {
    title: "New booking inquiry",
    body: `${booking.requesterName} wants to book you for ${dateText}`,
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
