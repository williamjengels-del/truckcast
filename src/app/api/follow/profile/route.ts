import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("business_name, city, state, subscription_tier")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Truck not found" }, { status: 404 });
  }

  if (profile.subscription_tier !== "premium") {
    return NextResponse.json(
      { error: "This feature is not available for this truck" },
      { status: 403 }
    );
  }

  const today = new Date().toISOString().split("T")[0];

  const { data: events } = await supabase
    .from("events")
    .select("event_name, event_date, start_time, end_time, location, city")
    .eq("user_id", userId)
    .eq("booked", true)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(10);

  return NextResponse.json({
    profile: {
      business_name: profile.business_name,
      city: profile.city,
      state: profile.state,
    },
    events: events || [],
  });
}
