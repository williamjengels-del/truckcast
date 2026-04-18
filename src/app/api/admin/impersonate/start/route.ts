import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_MAX_AGE_SECONDS,
  buildImpersonationCookiePayload,
  signImpersonationPayload,
} from "@/lib/admin-impersonation";

// POST /api/admin/impersonate/start
// Body: { userId }
//
// Starts a 30-minute read-only impersonation session for the target
// user. Admin-gated. Side effects:
//   * Sets vc_impersonate cookie (HttpOnly, Secure, SameSite=Lax)
//   * Writes audit log row: user.impersonate_start
//
// Does NOT redirect — the admin UI is expected to redirect to
// /dashboard client-side after receiving the 200 response. That keeps
// the route a clean JSON API and lets the UI decide the next destination.

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetUserId = body.userId;
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Prevent self-impersonation — it's a no-op that still writes a
  // confusing audit row. Reject early.
  if (targetUserId === admin.id) {
    return NextResponse.json(
      { error: "Cannot impersonate yourself" },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify target exists and grab identifying info for the audit row
  // (so the activity feed reads "began impersonating Wok-O Taco" rather
  // than a bare uuid).
  const { data: targetProfile } = await service
    .from("profiles")
    .select("business_name")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!targetProfile) {
    return NextResponse.json(
      { error: `No profile found for userId ${targetUserId}` },
      { status: 404 }
    );
  }
  const { data: targetAuth } = await service.auth.admin.getUserById(targetUserId);
  const targetEmail = targetAuth?.user?.email ?? null;

  // Build + sign the cookie payload.
  let cookieValue: string;
  const payload = buildImpersonationCookiePayload(admin.id, targetUserId);
  try {
    cookieValue = signImpersonationPayload(payload);
  } catch (err) {
    // IMPERSONATION_SIGNING_SECRET missing or too short. Fail-closed —
    // clearer 500 for the admin instead of setting an invalid cookie.
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Impersonation unavailable: ${err.message}`
            : "Impersonation unavailable",
      },
      { status: 500 }
    );
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.impersonate_start",
      targetType: "user",
      targetId: targetUserId,
      metadata: {
        target_email: targetEmail,
        target_business_name: targetProfile.business_name ?? null,
        expires_at: new Date(payload.e).toISOString(),
      },
    },
    service
  );

  const res = NextResponse.json({
    ok: true,
    target: {
      userId: targetUserId,
      email: targetEmail,
      businessName: targetProfile.business_name ?? null,
    },
    expiresAt: payload.e,
  });
  res.cookies.set({
    name: IMPERSONATION_COOKIE,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
