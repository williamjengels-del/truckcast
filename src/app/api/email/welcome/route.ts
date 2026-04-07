import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWelcomeEmail } from "@/lib/email";

/**
 * POST /api/email/welcome
 * Sends a welcome email to the newly signed-up user.
 * Called client-side immediately after successful signup.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { businessName } = await req.json().catch(() => ({}));
    await sendWelcomeEmail(user.email!, businessName ?? "");

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Never let email failure break the user flow
    console.error("Welcome email failed:", err);
    return NextResponse.json({ ok: false });
  }
}
