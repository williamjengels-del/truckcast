import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import { pairKey } from "@/lib/event-name-similarity";

/**
 * POST /api/admin/event-aliases/suggestions/dismiss
 *
 * Body: { a: string, b: string } — display strings or normalized
 * strings; we lowercase+trim before keying so either works.
 *
 * Persists the pair on the event_alias_dismissed_pairs table so the
 * suggestion list stops surfacing it. Admin still has the existing
 * 'add alias' path if they change their mind.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const r = body as Record<string, unknown>;
  const aRaw = typeof r.a === "string" ? r.a : "";
  const bRaw = typeof r.b === "string" ? r.b : "";
  if (!aRaw || !bRaw) {
    return NextResponse.json(
      { error: "a and b are both required" },
      { status: 400 }
    );
  }
  const a = aRaw.trim().toLowerCase();
  const b = bRaw.trim().toLowerCase();
  if (a === b) {
    return NextResponse.json(
      { error: "a and b normalize to the same string" },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const key = pairKey(a, b);
  const { error } = await service
    .from("event_alias_dismissed_pairs")
    .upsert({ pair_key: key, dismissed_by: admin.id }, { onConflict: "pair_key" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "event_alias.dismiss_suggestion",
      targetType: "event_alias",
      targetId: key,
      metadata: { a, b },
    },
    service
  );

  return NextResponse.json({ ok: true });
}
