import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "williamjengels@gmail.com";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/admin/reset-account
 * Wipes all event data for the current user and resets onboarding,
 * WITHOUT touching auth, admin status, or subscription tier.
 * Admin only.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = getServiceClient();
  const userId = user.id;

  // Delete in dependency order
  await service.from("event_performance").delete().eq("user_id", userId);
  await service.from("events").delete().eq("user_id", userId);
  await service.from("contacts").delete().eq("user_id", userId);
  await service.from("booking_requests").delete().eq("truck_user_id", userId);

  // Reset profile fields but preserve subscription_tier, stripe info, admin status
  await service
    .from("profiles")
    .update({
      onboarding_completed: false,
      team_share_token: null,
    })
    .eq("id", userId);

  return NextResponse.json({ success: true, message: "Account data wiped. Onboarding reset." });
}
