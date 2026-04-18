import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import {
  IMPERSONATION_COOKIE,
  getImpersonationContext,
} from "@/lib/admin-impersonation";

// POST /api/admin/impersonate/stop
//
// Ends the active impersonation session. Idempotent — calling with no
// active session clears the cookie (if present) and returns 200 without
// an audit row. Calling with an active session writes a user.impersonate_end
// audit row with duration_seconds metadata.
//
// Only the admin who STARTED the session can end it through this route
// (by virtue of being the admin with the cookie). The cookie is cleared
// regardless, so a stale/invalid cookie can always be flushed by POSTing
// here.

export async function POST() {
  // Admin gate. The caller should still be the admin (impersonation is
  // layered on top of admin auth, not a session swap). If someone hits
  // this unauthenticated or as a non-admin, clear the cookie anyway as
  // a safety net but don't log an audit row.
  const admin = await getAdminUser();

  const ctx = await getImpersonationContext();

  const res = NextResponse.json({
    ok: true,
    ended: !!ctx,
    duration_seconds: ctx
      ? Math.round((Date.now() - ctx.startedAt) / 1000)
      : null,
  });

  // Clear cookie unconditionally. Using an explicit past-date expiry
  // alongside maxAge=0 for broad browser compatibility.
  res.cookies.set({
    name: IMPERSONATION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  // Only audit when we had both a real admin AND an active session,
  // and the cookie actually belonged to this admin. Anything else is
  // a cleanup no-op — writing an audit row for it would be noise.
  if (admin && ctx && ctx.adminUserId === admin.id) {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await logAdminAction(
      {
        adminUserId: admin.id,
        action: "user.impersonate_end",
        targetType: "user",
        targetId: ctx.targetUserId,
        metadata: {
          duration_seconds: Math.round((Date.now() - ctx.startedAt) / 1000),
          started_at: new Date(ctx.startedAt).toISOString(),
          exit_reason: "manual",
        },
      },
      service
    );
  }

  return res;
}
