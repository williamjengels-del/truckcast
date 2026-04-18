import { createClient } from "@/lib/supabase/server";

// POST /api/push/subscribe
//
// Body: { endpoint, keys: { p256dh, auth } }  — the shape returned by
//        navigator.serviceWorker.pushManager.subscribe().toJSON()
//
// Upserts a row in push_subscriptions keyed on `endpoint` (unique). If a
// user re-subscribes on the same device the endpoint stays the same and
// we just refresh timestamps; on a new device the endpoint differs and
// we add a new row.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = payload.endpoint;
  const p256dh = payload.keys?.p256dh;
  const auth = payload.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return Response.json(
      { error: "Missing endpoint or keys" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: payload.userAgent ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

// DELETE /api/push/subscribe?endpoint=<endpoint>
//
// Removes the user's subscription row for the given endpoint. Called when
// the user disables notifications in Settings (and we also unsubscribe the
// PushManager on the client). 404 if no matching row — treat as idempotent
// success from caller's perspective.
export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) {
    return Response.json({ error: "Missing endpoint" }, { status: 400 });
  }

  // RLS restricts this to rows where user_id = auth.uid(), so we can't
  // accidentally delete someone else's subscription even if endpoint matches.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
