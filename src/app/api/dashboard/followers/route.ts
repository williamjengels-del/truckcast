import { NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

// GET /api/dashboard/followers
//
// Returns the profile + active follower subscriptions for the current
// dashboard scope. Consumed by
// src/app/dashboard/contacts/followers-tab.tsx.
//
// The tab needs the profile to check `subscription_tier === "premium"`
// (followers is a premium-tier feature), and the active subscriber
// list if eligible. Bundling both into one endpoint matches the
// existing client code's two-call sequence with a single round-trip.
// The server-side tier check also avoids surfacing the subscriber list
// at all for non-premium accounts — consistent with the client guard.

export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await scope.client
    .from("profiles")
    .select("*")
    .eq("id", scope.userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const tier = (profile as { subscription_tier?: string } | null)
    ?.subscription_tier;
  if (tier !== "premium") {
    return NextResponse.json({ profile, followers: [] });
  }

  const { data: followers, error: followersError } = await scope.client
    .from("follow_subscribers")
    .select("*")
    .eq("truck_user_id", scope.userId)
    .is("unsubscribed_at", null)
    .order("subscribed_at", { ascending: false });

  if (followersError) {
    return NextResponse.json({ error: followersError.message }, { status: 500 });
  }

  return NextResponse.json({ profile, followers: followers ?? [] });
}
