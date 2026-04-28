import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/mfa/disable
 *
 * Server-side wrapper for "disable two-factor authentication." The
 * client could call supabase.auth.mfa.unenroll() directly, but doing
 * so would orphan the operator's recovery codes. Routing through the
 * server lets us delete the factor + the recovery codes atomically.
 *
 * Body: { factorId: string }
 *
 * Caller must be authenticated and at AAL2 — operators shouldn't be
 * able to disable 2FA from a password-only session. The proxy AAL
 * gate /api/* mutation block enforces this; we re-check defensively.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Defense-in-depth — the proxy gate should already have blocked
  // AAL1 mutations, but the cost of double-checking here is one JWT
  // claim read.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return NextResponse.json(
      { error: "AAL2 required to disable two-factor authentication" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const factorId = (body as { factorId?: string } | null)?.factorId;
  if (!factorId || typeof factorId !== "string") {
    return NextResponse.json({ error: "factorId required" }, { status: 400 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Delete the factor via the admin API.
  const { error: factorErr } = await service.auth.admin.mfa.deleteFactor({
    userId: user.id,
    id: factorId,
  });
  if (factorErr) {
    return NextResponse.json({ error: factorErr.message }, { status: 500 });
  }

  // Recovery codes are tied to the now-deleted factor — clear them.
  await service
    .from("profile_recovery_codes")
    .delete()
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
