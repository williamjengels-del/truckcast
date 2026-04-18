import { NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

// GET /api/dashboard/pos-connections
//
// Returns all pos_connections rows for the current dashboard scope.
// Consumed by src/app/dashboard/integrations/pos-tab.tsx.

export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await scope.client
    .from("pos_connections")
    .select("*")
    .eq("user_id", scope.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ connections: data ?? [] });
}
