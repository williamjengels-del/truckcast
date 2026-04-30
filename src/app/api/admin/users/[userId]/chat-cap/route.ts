import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";

// POST /api/admin/users/[userId]/chat-cap
// Body: { overrideCents: number | null }
//
// Sets or clears the per-operator Tier-B chatbot monthly cost cap. NULL
// means "use the env default" (chatV2MonthlyCapCents() resolution).
// Positive integers (cents) win over the env value. Values <= 0 are
// rejected — clearing intent must be expressed as null, not 0.
//
// Audit-logged as user.cap_override_set with from/to context.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await ctx.params;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  let body: { overrideCents?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.overrideCents;
  let nextOverride: number | null;
  if (raw === null || raw === undefined) {
    nextOverride = null;
  } else if (typeof raw === "number" && Number.isFinite(raw) && Number.isInteger(raw) && raw > 0) {
    nextOverride = raw;
  } else {
    return NextResponse.json(
      { error: "overrideCents must be a positive integer or null" },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Read previous override + identifying info before the mutation, so the
  // audit row captures from→to without a follow-up read.
  const { data: prevProfile } = await service
    .from("profiles")
    .select("chat_v2_monthly_cap_cents_override, business_name")
    .eq("id", userId)
    .maybeSingle();
  if (!prevProfile) {
    return NextResponse.json(
      { error: `No profile found for userId ${userId}` },
      { status: 404 }
    );
  }
  const prevOverride =
    (
      prevProfile as {
        chat_v2_monthly_cap_cents_override?: number | null;
      }
    ).chat_v2_monthly_cap_cents_override ?? null;

  const { error: updateError } = await service
    .from("profiles")
    .update({ chat_v2_monthly_cap_cents_override: nextOverride })
    .eq("id", userId);
  if (updateError) {
    return NextResponse.json(
      { error: `Update failed: ${updateError.message}` },
      { status: 500 }
    );
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.cap_override_set",
      targetType: "user",
      targetId: userId,
      metadata: {
        from: prevOverride,
        to: nextOverride,
        target_business_name:
          (prevProfile as { business_name?: string | null }).business_name ??
          null,
      },
    },
    service
  );

  return NextResponse.json({ ok: true, overrideCents: nextOverride });
}
