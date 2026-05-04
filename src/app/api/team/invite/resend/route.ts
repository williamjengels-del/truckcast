import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendManagerInviteEmail } from "@/lib/email";

/**
 * POST /api/team/invite/resend
 *
 * Body: { memberId: string }
 *
 * Re-fires the manager invite email for an existing team_members row
 * without touching the row itself. Removes the previous Remove +
 * Send-Invite churn — owner can keep the manager's status / Financials
 * toggle / accepted history intact and just hand them a fresh login
 * link.
 *
 * Always uses the existing-user (magic-link + branded Resend email)
 * path. Both pending and active managers already have an auth user
 * by the time they're in team_members — pending because the original
 * invite created them; active because they accepted. So
 * inviteUserByEmail's "already registered" rejection is guaranteed
 * here, and we skip it entirely.
 */
function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Managers can't trigger resend for other managers — only owners.
  // Same posture as the rest of /api/team/invite.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("owner_user_id, business_name")
    .eq("id", user.id)
    .single();
  if (
    (myProfile as { owner_user_id?: string | null } | null)?.owner_user_id
  ) {
    return NextResponse.json(
      { error: "Managers cannot resend invites." },
      { status: 403 }
    );
  }
  const ownerBusinessName =
    (myProfile as { business_name?: string | null } | null)?.business_name ??
    "";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const memberId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).memberId
      : null;
  if (typeof memberId !== "string" || !memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  // Lookup the row, scoped to the caller's owner rows. Service role for
  // the email lookup but RLS-authed read first to gate authorization
  // (caller can only resend on their own invites).
  const { data: member, error: memberError } = await supabase
    .from("team_members")
    .select("id, member_email")
    .eq("id", memberId)
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (memberError || !member) {
    return NextResponse.json(
      { error: memberError?.message ?? "Manager not found" },
      { status: 404 }
    );
  }
  const email = (member as { member_email: string }).member_email;

  const admin = getAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/team/accept`;

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkError?.message ?? "Could not generate invite link" },
      { status: 500 }
    );
  }
  try {
    await sendManagerInviteEmail(
      email,
      ownerBusinessName,
      linkData.properties.action_link
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Could not send manager invite email",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
