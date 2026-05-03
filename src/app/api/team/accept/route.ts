import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/team/accept
 *
 * Manager accept-invite handler. Replaces the previous client-side
 * activation in /dashboard/team/accept which was vulnerable to two
 * silent failures:
 *
 *   1. team_members RLS only allows the **owner** to UPDATE rows
 *      (`USING (owner_user_id = auth.uid())`). When the **manager**
 *      tried to flip status pending → active, the UPDATE returned 0
 *      rows with no error and the page declared success anyway.
 *   2. The profiles UPDATE that followed went unawaited and unchecked.
 *      Even if it had succeeded, no atomicity with step 1.
 *
 * Result: managers ended up "active" in some views but with
 * profiles.owner_user_id = NULL — leaking into the marketplace
 * routing as if they were independent operators (Phase 7 routing
 * uses .is("owner_user_id", null) to mean "non-manager").
 *
 * This route runs server-side with the service role, atomically:
 *   - Verifies the caller is the invited email holder
 *   - Activates team_members (status='active', member_user_id=caller)
 *   - Normalizes the manager's profile: sets owner_user_id, clears
 *     business_name + city (managers don't carry independent brand
 *     identity per the v1 model), forces onboarding_completed=false
 *     (managers see the owner's data, not their own onboarding flow).
 *
 * Returns the owner_user_id on success so the client can redirect
 * appropriately.
 */
export async function POST() {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json(
      { error: "You must be signed in to accept an invitation." },
      { status: 401 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const memberEmail = user.email.toLowerCase();

  // Find an invite for this email — accept either pending OR active
  // (the latter handles the legacy state where a previous broken
  // accept set status='active' but never linked the profile).
  const { data: invite, error: inviteReadError } = await service
    .from("team_members")
    .select("id, owner_user_id, status, member_user_id")
    .eq("member_email", memberEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inviteReadError) {
    return NextResponse.json(
      { error: inviteReadError.message },
      { status: 500 }
    );
  }
  if (!invite) {
    return NextResponse.json(
      {
        error:
          "No invitation found for this email. Ask the account owner to re-send the invite.",
      },
      { status: 404 }
    );
  }

  // Self-invite guard — should never happen, but the data shouldn't
  // allow an owner to invite themselves anyway.
  if (invite.owner_user_id === user.id) {
    return NextResponse.json(
      { error: "You cannot accept an invitation you sent." },
      { status: 400 }
    );
  }

  // Activate team_members slot (idempotent — already-active rows
  // simply get re-stamped with the same caller's user_id).
  const { error: activateError } = await service
    .from("team_members")
    .update({ member_user_id: user.id, status: "active" })
    .eq("id", invite.id);
  if (activateError) {
    return NextResponse.json(
      { error: `Failed to activate invitation: ${activateError.message}` },
      { status: 500 }
    );
  }

  // Normalize manager's profile. Per the v1 model:
  //   - owner_user_id points to the operator they manage.
  //   - business_name + city cleared (manager doesn't carry brand
  //     identity; sees owner's data via RLS).
  //   - onboarding_completed=false so they don't accidentally appear
  //     in marketplace routing (which requires onboarding_completed=true)
  //     and so any future operator-vs-manager-onboarding logic can
  //     branch correctly.
  const { error: profileError } = await service
    .from("profiles")
    .update({
      owner_user_id: invite.owner_user_id,
      business_name: null,
      city: null,
      onboarding_completed: false,
    })
    .eq("id", user.id);
  if (profileError) {
    return NextResponse.json(
      { error: `Failed to link manager profile: ${profileError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, owner_user_id: invite.owner_user_id });
}
