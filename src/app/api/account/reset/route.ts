import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * POST /api/account/reset
 *
 * User-facing "wipe my own data" action. Deletes the caller's events,
 * event_performance rows, contacts, and booking_requests, then resets
 * onboarding_completed + team_share_token on their profile. Does NOT
 * touch auth, subscription_tier, stripe_customer_id, trial state, or
 * anything else that governs account access.
 *
 * Self-only — acts on the caller's own auth.uid(). No admin gate, no
 * audit log entry. This is a personal action (equivalent to a factory
 * reset of a phone), not an admin-acting-on-someone-else action.
 *
 * Mutation — automatically rejected by the Commit 5b proxy mutation
 * block during an active impersonation session. Correct: an admin
 * impersonating a user shouldn't be able to wipe the target's data
 * through this route.
 *
 * Moved from /api/admin/reset-account in Commit 7. The previous
 * admin-gated variant was functionally the same but sat behind
 * /api/admin/* and wrote a self.account_reset audit row. With the
 * functionality now user-facing (any authenticated user can reset
 * their own account), the admin gate + audit log both come off.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Service-role client for the delete cascade — user's own session
  // could do most of these via RLS-authorized deletes, but chaining
  // five delete calls as one atomic-ish unit is simpler at the
  // service-role layer and matches the prior implementation.
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const userId = user.id;

  // Delete in FK-dependency order.
  await service.from("event_performance").delete().eq("user_id", userId);
  await service.from("events").delete().eq("user_id", userId);
  await service.from("contacts").delete().eq("user_id", userId);
  await service.from("booking_requests").delete().eq("truck_user_id", userId);

  // Reset onboarding + team share token. Preserve subscription_tier,
  // stripe_* identifiers, trial_extended_until, admin allowlist
  // membership (implicit — that's tracked in code, not in the profile),
  // data_sharing_enabled, and everything else that isn't strictly
  // "user-generated data."
  await service
    .from("profiles")
    .update({
      onboarding_completed: false,
      team_share_token: null,
    })
    .eq("id", userId);

  return NextResponse.json({
    success: true,
    message: "Account data wiped. Onboarding reset.",
  });
}
