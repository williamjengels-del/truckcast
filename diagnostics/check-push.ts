/* eslint-disable @typescript-eslint/no-explicit-any */
// Diagnostic: inspect Julian's push_subscriptions row.
// Run: npx tsx --env-file=.env.local diagnostics/check-push.ts

import { createClient } from "@supabase/supabase-js";

const OWNER_USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, user_agent, created_at, last_used_at")
    .eq("user_id", OWNER_USER_ID);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  console.log(`push_subscriptions rows for owner: ${data?.length ?? 0}`);
  for (const row of data ?? []) {
    console.log("");
    console.log(`  id:            ${row.id}`);
    console.log(`  endpoint:      ${row.endpoint?.slice(0, 80)}${(row.endpoint?.length ?? 0) > 80 ? "…" : ""}`);
    console.log(`  endpoint host: ${new URL(row.endpoint).host}`);
    console.log(`  p256dh len:    ${row.p256dh?.length ?? 0}`);
    console.log(`  auth len:      ${row.auth?.length ?? 0}`);
    console.log(`  user_agent:    ${row.user_agent ?? "(none)"}`);
    console.log(`  created_at:    ${row.created_at}`);
    console.log(`  last_used_at:  ${row.last_used_at ?? "(never)"}`);
  }

  // Recent booking_requests for this user so we can correlate with the test
  console.log("");
  console.log("Recent booking_requests (last 5):");
  const { data: bookings } = await supabase
    .from("booking_requests")
    .select("id, requester_name, event_date, created_at")
    .eq("truck_user_id", OWNER_USER_ID)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const b of bookings ?? []) {
    console.log(`  ${b.created_at}  ${b.requester_name} (${b.event_date ?? "no date"})  ${(b.id as string).slice(0, 8)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
