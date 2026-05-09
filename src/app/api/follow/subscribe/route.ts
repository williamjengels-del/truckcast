import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";

// email-1: IP-based rate limit on the unauthenticated subscriber-add
// endpoint. 10 / hour / IP — well above plausible legitimate use
// (operator self-testing or shared-LAN signups), low enough to cap the
// confirmation-email-bomb scenario.
const SUBSCRIBE_RATE_LIMIT = 10;
const SUBSCRIBE_RATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request);
  if (
    ip !== "unknown" &&
    !checkRateLimit(`follow:${ip}`, SUBSCRIBE_RATE_LIMIT, SUBSCRIBE_RATE_WINDOW_MS)
  ) {
    return NextResponse.json(
      { error: "Too many subscription requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  try {
    const body = await request.json();
    const { userId, email, name } = body;

    if (!userId || !email) {
      return NextResponse.json(
        { error: "userId and email are required" },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Check truck owner exists and is on Premium tier
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, subscription_tier")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Truck not found" },
        { status: 404 }
      );
    }

    if (profile.subscription_tier !== "premium") {
      return NextResponse.json(
        { error: "This feature requires a Premium subscription" },
        { status: 403 }
      );
    }

    // Check if already subscribed
    const { data: existing } = await supabase
      .from("follow_subscribers")
      .select("id, unsubscribed_at")
      .eq("truck_user_id", userId)
      .eq("email", email.toLowerCase().trim())
      .single();

    if (existing) {
      if (existing.unsubscribed_at) {
        // Re-subscribe
        await supabase
          .from("follow_subscribers")
          .update({
            unsubscribed_at: null,
            name: name?.trim() || null,
            subscribed_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        return NextResponse.json({ success: true, resubscribed: true });
      }
      return NextResponse.json({ success: true, alreadySubscribed: true });
    }

    // Insert new subscriber
    const { error: insertError } = await supabase
      .from("follow_subscribers")
      .insert({
        truck_user_id: userId,
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
      });

    if (insertError) {
      console.error("Follow subscribe error:", insertError);
      return NextResponse.json(
        { error: "Failed to subscribe" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
