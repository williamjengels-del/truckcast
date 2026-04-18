import { NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";

// GET /api/dashboard/bookings
//
// Returns booking_requests where truck_user_id matches the current
// dashboard scope, newest first. Consumed by
// src/app/dashboard/bookings/page.tsx.
//
// Note the column name is `truck_user_id` on this table (not
// `user_id`) — booking_requests represent inquiries FROM customers
// TO a food truck operator, so the operator is the "truck user".

export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await scope.client
    .from("booking_requests")
    .select("*")
    .eq("truck_user_id", scope.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ bookings: data ?? [] });
}
