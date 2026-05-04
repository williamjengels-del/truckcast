import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

/**
 * PATCH /api/admin/users/[userId]/onboarding
 *
 * Body: { onboarding_completed: boolean }
 *
 * Admin path to flip an operator's onboarding_completed flag without
 * forcing them back through the wizard. Most common case: an operator
 * who signed up but never finished onboarding ends up invisible to
 * marketplace inquiry routing (which gates on the flag — see
 * src/lib/event-inquiry-routing.ts:52). When the operator is real
 * (has a city / business name set) but just paused on the wizard,
 * we want a way to mark them ready without making them re-walk the
 * setup flow.
 *
 * Inverse path also useful: setting back to false sends the operator
 * through the wizard the next time they hit the dashboard (the
 * middleware onboarding gate at src/lib/supabase/middleware.ts kicks
 * in). Useful for testing or when the operator's profile got into a
 * bad state.
 *
 * Audit-logged as user.onboarding_set with metadata
 * { from, to, email }.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
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
  const next = (body as Record<string, unknown>).onboarding_completed;
  if (typeof next !== "boolean") {
    return NextResponse.json(
      { error: "onboarding_completed (boolean) required" },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Capture prior + email for the audit row before mutating.
  const { data: prior, error: priorError } = await service
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();
  if (priorError || !prior) {
    return NextResponse.json(
      { error: priorError?.message ?? "User not found" },
      { status: 404 }
    );
  }
  const from = (prior as { onboarding_completed: boolean | null })
    .onboarding_completed === true;
  const { data: target } = await service.auth.admin.getUserById(userId);
  const email = target?.user?.email ?? null;

  if (from === next) {
    // No-op write would still log noise. Short-circuit.
    return NextResponse.json({ ok: true, onboarding_completed: next });
  }

  const { error: updateError } = await service
    .from("profiles")
    .update({ onboarding_completed: next })
    .eq("id", userId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.onboarding_set",
      targetType: "user",
      targetId: userId,
      metadata: { email, from, to: next },
    },
    service
  );

  return NextResponse.json({ ok: true, onboarding_completed: next });
}
