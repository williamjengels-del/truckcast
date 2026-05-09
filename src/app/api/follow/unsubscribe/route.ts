import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, email } = body;

    if (!userId || !email) {
      return NextResponse.json(
        { error: "userId and email are required" },
        { status: 400 }
      );
    }

    // Use service role intentionally: the public RLS UPDATE policy on
    // follow_subscribers was dropped in migration 20260509000002 because
    // it allowed any-column mutation by any anonymous client. The route
    // is the chokepoint that enforces "update only the unsubscribed_at
    // column on a row matching (userId, email)". Server-side only —
    // service key never reaches a browser.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 503 }
      );
    }
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await supabase
      .from("follow_subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("truck_user_id", userId)
      .eq("email", email.toLowerCase().trim())
      .is("unsubscribed_at", null);

    if (error) {
      console.error("Unsubscribe error:", error);
      return NextResponse.json(
        { error: "Failed to unsubscribe" },
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
