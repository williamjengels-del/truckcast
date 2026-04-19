import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/beta/redeem
 * Redeems a beta invite code for the currently authenticated user.
 * Grants the specified tier for the trial period.
 *
 * Body: { code: string }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code } = await request.json();
    if (!code?.trim()) {
      return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
    }

    // Look up the invite code
    const { data: invite, error: lookupError } = await supabase
      .from("beta_invites")
      .select("*")
      .eq("code", code.trim().toUpperCase())
      .single();

    if (lookupError || !invite) {
      return NextResponse.json(
        { error: "Invalid invite code. Please check and try again." },
        { status: 404 }
      );
    }

    // Already redeemed?
    if (invite.redeemed_by) {
      return NextResponse.json(
        { error: "This invite code has already been used." },
        { status: 409 }
      );
    }

    // Expired?
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This invite code has expired." },
        { status: 410 }
      );
    }

    // Email-restricted?
    if (invite.email && invite.email.toLowerCase() !== user.email?.toLowerCase()) {
      return NextResponse.json(
        { error: "This invite code is restricted to a different email address." },
        { status: 403 }
      );
    }

    // Mark invite as redeemed
    const { error: redeemError } = await supabase
      .from("beta_invites")
      .update({
        redeemed_by: user.id,
        redeemed_at: new Date().toISOString(),
      })
      .eq("id", invite.id)
      .is("redeemed_by", null); // optimistic lock: only redeem if still unredeemed

    if (redeemError) {
      return NextResponse.json(
        { error: "Failed to redeem invite code. Please try again." },
        { status: 500 }
      );
    }

    // Upgrade the user's subscription tier AND extend their trial
    // window to match the invite's trial_days.
    //
    // The second write matters because the middleware's trial gate
    // (src/lib/supabase/middleware.ts) only bypasses for users with
    // a stripe_subscription_id — beta users don't have one. Without
    // setting trial_extended_until here, beta Pro/Premium users
    // would hit the hard gate on 2026-05-01 despite having been
    // granted the tier. Setting the column to now + trial_days (30,
    // 60, 90, or whatever the invite specified) gives them a real,
    // visible expiry and lets the admin extend further via the
    // existing trial-extension tools if needed.
    const trialExtendedUntil = new Date(
      Date.now() + invite.trial_days * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        subscription_tier: invite.granted_tier,
        trial_extended_until: trialExtendedUntil,
      })
      .eq("id", user.id);

    if (profileError) {
      return NextResponse.json(
        { error: "Code redeemed but failed to update your plan. Contact support." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      grantedTier: invite.granted_tier,
      trialDays: invite.trial_days,
      message: `Welcome to the VendCast beta! Your account has been upgraded to ${invite.granted_tier} for ${invite.trial_days} days.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/beta/redeem?code=<code>
 * Validates an invite code without redeeming it. Used on the signup page.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json({ valid: false, error: "No code provided" });
    }

    const supabase = await createClient();
    const { data: invite } = await supabase
      .from("beta_invites")
      .select("id, granted_tier, trial_days, redeemed_by, expires_at, email")
      .eq("code", code.trim().toUpperCase())
      .single();

    if (!invite) return NextResponse.json({ valid: false, error: "Code not found" });
    if (invite.redeemed_by) return NextResponse.json({ valid: false, error: "Already redeemed" });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: "Expired" });
    }

    return NextResponse.json({
      valid: true,
      grantedTier: invite.granted_tier,
      trialDays: invite.trial_days,
      emailRestricted: !!invite.email,
    });
  } catch (err) {
    return NextResponse.json(
      { valid: false, error: err instanceof Error ? err.message : "Error" }
    );
  }
}
