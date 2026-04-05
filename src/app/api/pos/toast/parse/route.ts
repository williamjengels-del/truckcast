import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseToastEmail } from "@/lib/pos/toast";
import { hasAccess } from "@/lib/subscription";
import type { Profile } from "@/lib/database.types";

/**
 * POST /api/pos/toast/parse
 * Parses a pasted Toast daily summary email and returns the extracted data.
 * Does NOT write to the database — that happens in /api/pos/toast/sync.
 *
 * Body: { emailContent: string }
 * Returns: { date, netSales, rawSubject, matchedEvent?: { id, event_name } }
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (!profile || !hasAccess((profile as Profile).subscription_tier, "pos_integration")) {
      return NextResponse.json(
        { error: "POS integration requires a Pro or Premium subscription" },
        { status: 403 }
      );
    }

    const { emailContent } = await request.json();
    if (!emailContent?.trim()) {
      return NextResponse.json(
        { error: "Email content is required" },
        { status: 400 }
      );
    }

    const parsed = parseToastEmail(emailContent);

    // Check if there's a booked event on this date
    const { data: events } = await supabase
      .from("events")
      .select("id, event_name")
      .eq("user_id", user.id)
      .eq("event_date", parsed.date)
      .eq("booked", true)
      .order("event_name");

    return NextResponse.json({
      date: parsed.date,
      netSales: parsed.netSales,
      rawSubject: parsed.rawSubject,
      matchedEvents: events ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 400 }
    );
  }
}
