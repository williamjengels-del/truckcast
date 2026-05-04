import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import type { Profile } from "@/lib/database.types";

const MANAGER_LIMITS: Record<string, number> = {
  starter: 0,
  pro: 1,
  premium: 5,
};

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/team/invite
 * Body: { email, financials_enabled? }
 * Invites a manager to the owner's account. financials_enabled defaults
 * to false — owner opts in deliberately.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Managers cannot invite others
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("subscription_tier, owner_user_id")
    .eq("id", user.id)
    .single();

  if (myProfile?.owner_user_id) {
    return NextResponse.json({ error: "Managers cannot invite other managers." }, { status: 403 });
  }

  const tier = (myProfile as Profile | null)?.subscription_tier ?? "starter";
  const limit = MANAGER_LIMITS[tier] ?? 0;

  if (limit === 0) {
    return NextResponse.json(
      { error: "Manager invites require a Pro or Premium subscription." },
      { status: 403 }
    );
  }

  // Check current active + pending count
  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .eq("owner_user_id", user.id);

  if ((existing?.length ?? 0) >= limit) {
    return NextResponse.json(
      { error: `Your ${tier} plan allows up to ${limit} manager${limit === 1 ? "" : "s"}. Upgrade to add more.` },
      { status: 403 }
    );
  }

  const { email, financials_enabled = false } = await request.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  // Check not already invited
  const { data: dupe } = await supabase
    .from("team_members")
    .select("id, status")
    .eq("owner_user_id", user.id)
    .eq("member_email", email.toLowerCase())
    .single();

  if (dupe) {
    return NextResponse.json(
      { error: `${email} has already been invited (status: ${dupe.status}).` },
      { status: 409 }
    );
  }

  // Create pending team_members record first
  const { error: insertError } = await supabase
    .from("team_members")
    .insert({
      owner_user_id: user.id,
      member_email: email.toLowerCase(),
      status: "pending",
      financials_enabled,
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Send invite via Supabase Auth admin
  const admin = getAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/team/accept`;

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { invited_by: user.id, role: "manager" },
  });

  if (inviteError) {
    // Roll back the team_members insert
    await supabase
      .from("team_members")
      .delete()
      .eq("owner_user_id", user.id)
      .eq("member_email", email.toLowerCase());

    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/**
 * GET /api/team/invite
 * Returns the team members list for the current dashboard scope —
 * which honors impersonation and manager-of-owner relationships, not
 * just the raw authenticated user. Without resolveScopedSupabase, an
 * admin "viewing as user X" would see their OWN team list instead of
 * X's, and a manager loading their owner's settings would see an
 * empty list. Impersonation read paths use the service-role client
 * because RLS would reject cross-user reads from the admin's session
 * (see src/lib/dashboard-scope.ts for the full rationale).
 *
 * Mutations (POST / DELETE) intentionally do NOT use this helper —
 * mutations are blocked outright by the impersonation middleware
 * before this handler runs (src/lib/supabase/middleware.ts).
 */
export async function GET() {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await scope.client
    .from("team_members")
    .select("*")
    .eq("owner_user_id", scope.userId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ members: data ?? [] });
}

/**
 * PATCH /api/team/invite
 * Body: { memberId, financials_enabled }
 *
 * Update a manager's Financials toggle after invite. Only the
 * caller's own team rows are mutable (RLS enforces this — the
 * "Owners manage their team" policy gates writes by
 * owner_user_id = auth.uid()), but we also gate by user.id in the
 * WHERE clause as belt-and-suspenders.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const memberId = typeof body.memberId === "string" ? body.memberId : null;
  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  if (typeof body.financials_enabled !== "boolean") {
    return NextResponse.json(
      { error: "financials_enabled (boolean) required" },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from("team_members")
    .update({ financials_enabled: body.financials_enabled })
    .eq("id", memberId)
    .eq("owner_user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/team/invite
 * Body: { memberId }
 * Revokes a manager's access.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId } = await request.json();

  // Also clear owner_user_id from the member's profile if active
  const { data: member } = await supabase
    .from("team_members")
    .select("member_user_id")
    .eq("id", memberId)
    .eq("owner_user_id", user.id)
    .single();

  if (member?.member_user_id) {
    const admin = getAdminClient();
    await admin
      .from("profiles")
      .update({ owner_user_id: null })
      .eq("id", member.member_user_id);
  }

  await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("owner_user_id", user.id);

  return NextResponse.json({ success: true });
}
