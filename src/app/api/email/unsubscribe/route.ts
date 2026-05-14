import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

// POST /api/email/unsubscribe
//
// Body: { userId: string, token: string }
//
// Verifies the HMAC token against userId, then sets
// `profiles.email_reminders_enabled = false` via service role. No
// auth required — that's the point: CAN-SPAM mandates a one-click
// internet-based opt-out that doesn't require login. The signed
// token bound to userId is the security gate.
//
// Idempotent — re-clicking the same link returns 200 even if the
// flag is already false. Avoids confusing "already unsubscribed"
// errors when an email scanner pre-clicks the link before the user.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const userId =
      typeof body.userId === "string" ? body.userId : "";
    const token = typeof body.token === "string" ? body.token : "";

    if (!userId || !token) {
      return NextResponse.json(
        { error: "Missing userId or token" },
        { status: 400 }
      );
    }

    // Re-verify the token server-side — don't trust the page-load
    // check. UNSUBSCRIBE_TOKEN_SECRET being absent / misconfigured
    // surfaces as 500 here (not a silent 401 that would let valid
    // tokens fail).
    let valid: boolean;
    try {
      valid = verifyUnsubscribeToken(userId, token);
    } catch {
      console.error("[unsubscribe] UNSUBSCRIBE_TOKEN_SECRET misconfigured");
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 503 }
      );
    }

    if (!valid) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 401 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 503 }
      );
    }

    // Service role — RLS on `profiles` only allows the owner to
    // update their own row, but this endpoint is intentionally
    // session-less. The HMAC verification above proves the caller
    // has a link issued for this specific userId; that's the trust
    // anchor that substitutes for an auth session.
    const supabase = createServiceClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await supabase
      .from("profiles")
      .update({ email_reminders_enabled: false })
      .eq("id", userId);

    if (error) {
      console.error("[unsubscribe] update failed:", error);
      return NextResponse.json(
        { error: "Failed to update preference" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[unsubscribe] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
