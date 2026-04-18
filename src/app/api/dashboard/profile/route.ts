import { NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

// GET /api/dashboard/profile
//
// Returns the full profile row for the current dashboard scope (self,
// manager-resolved owner, or impersonation target). Consumed by:
//   src/app/dashboard/settings/page.tsx
//   src/app/dashboard/integrations/pos-tab.tsx
//   src/app/dashboard/contacts/followers-tab.tsx
//
// Security posture: admin impersonation reads are mediated by the
// signed vc_impersonate cookie via resolveScopedSupabase. Regular
// users see their own profile; managers see their owner's profile
// (same behavior as the server-rendered pages).

export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await scope.client
    .from("profiles")
    .select("*")
    .eq("id", scope.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}
