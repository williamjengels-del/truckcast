import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  sendPushToSubscriptions,
  type PushPayload,
  type PushSubscriptionRow,
} from "@/lib/push";

// POST /api/push/send
//
// Internal-only. Caller must present the CRON_SECRET as bearer auth or via
// an x-cron-secret header. Never exposed to end users.
//
// Body: { user_id: string, payload: PushPayload }
//
// Looks up all active push subscriptions for that user and fans the payload
// out. Cleans up subscriptions whose push service returned 404/410 (dead
// endpoint — user revoked permission, uninstalled the PWA, etc.).
export async function POST(req: Request) {
  // Auth — bearer or x-cron-secret header. Same shared-secret pattern the
  // Vercel crons use for their own calls.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (bearer !== expected && headerSecret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { user_id?: string; payload?: PushPayload };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.user_id;
  const payload = body.payload;
  if (!userId || !payload?.title || typeof payload.body !== "string") {
    return Response.json(
      { error: "Missing user_id or payload {title, body}" },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const subs = (data ?? []) as PushSubscriptionRow[];
  if (subs.length === 0) {
    return Response.json({ ok: true, delivered: 0, failed: 0, subs: 0 });
  }

  const result = await sendPushToSubscriptions(subs, payload);

  // Clean up dead endpoints so we don't keep hammering them.
  // user_id scoping is critical: two users could theoretically share
  // an endpoint string (rare, but possible if a shared device is
  // reused across accounts or if cleanup logic ever leaks endpoints
  // from another user's lookup). Without this filter, the service-
  // role delete would remove other users' subs to the same endpoint.
  if (result.invalidEndpoints.length > 0) {
    await service
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .in("endpoint", result.invalidEndpoints);
  }

  // Touch last_used_at for surviving subs so we can see which devices are
  // actually receiving pushes. Same user_id-scope rationale as above.
  const survivingEndpoints = subs
    .map((s) => s.endpoint)
    .filter((e) => !result.invalidEndpoints.includes(e));
  if (survivingEndpoints.length > 0) {
    await service
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("endpoint", survivingEndpoints);
  }

  return Response.json({
    ok: true,
    subs: subs.length,
    delivered: result.delivered,
    failed: result.failed,
    cleaned: result.invalidEndpoints.length,
  });
}
