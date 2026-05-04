// Resolves which user a dashboard read should be scoped to, and which
// Supabase client should execute the read.
//
// This is the ONE helper that answers "whose data am I loading right
// now?" for all user-scoped dashboard code. It unifies three cases that
// previously lived as inline logic in each page:
//
//   1. Normal — a user viewing their own dashboard.
//        userId = auth.uid(), client = RLS-authed (cookies)
//
//   2. Manager — a team member viewing their owner's dashboard.
//        userId = profile.owner_user_id, client = RLS-authed.
//        (Existing RLS policies on events + related tables allow
//        managers to read owner rows via the team_members table —
//        see migration 20260417000002_add_team_members.sql.)
//
//   3. Impersonating — an admin "View dashboard as this user" session.
//        userId = impersonation.target_user_id, client = service-role.
//        Service-role required because standard RLS rejects reads of
//        another user's data from the admin's session, and per Path γ
//        we declined to broaden RLS with an admin bypass. Read access
//        is tied to the signed impersonation cookie, not ambient
//        capability.
//
// Precedence:
//   Impersonation > Manager > Normal.
//   An admin impersonating somebody loads the target's data even if
//   the admin is also a manager of some other account.
//
// Failure modes:
//   * No authenticated user — returns { kind: "unauthorized" }. In
//     practice middleware catches this before dashboard pages render,
//     but the helper returns the case explicitly for defense-in-depth.
//   * Impersonation cookie present but admin_user_id doesn't match the
//     current session's real user (cookie leaked / swapped) — the
//     cookie is silently ignored and we fall through to manager/normal.
//     No error is surfaced. "Inert cookie" is the designed behavior for
//     cross-session cookie exposure; explicit forbidden errors would
//     only punish the legitimate admin who happened to clear cookies
//     or re-login.
//   * Impersonation cookie present but the user is no longer an admin
//     (allowlist changed, user removed) — same behavior, cookie ignored.

import {
  createClient as createServiceClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient as createRlsClient } from "@/lib/supabase/server";
import { getImpersonationContext } from "@/lib/admin-impersonation";
import { isAdmin } from "@/lib/admin";

export type DashboardScope =
  | {
      kind: "normal";
      userId: string;
      realUserId: string;
      client: SupabaseClient;
      isImpersonating: false;
    }
  | {
      kind: "manager";
      userId: string; // owner_user_id
      realUserId: string; // manager's own id
      client: SupabaseClient;
      isImpersonating: false;
      // Owner-controlled, off by default. When false, managers cannot
      // see revenue, forecasts, post-event sales entry, or historical
      // performance data. Operations access (events, inquiries,
      // calendar, contacts, notes) is independent of this flag.
      financialsEnabled: boolean;
    }
  | {
      kind: "impersonating";
      userId: string; // target
      realUserId: string; // admin
      client: SupabaseClient; // service-role
      isImpersonating: true;
      startedAt: number;
      expiresAt: number;
    }
  | {
      kind: "unauthorized";
    };

/**
 * Can the current viewer see revenue, forecasts, sales entry, and
 * historical performance? Owners + impersonating admins always can.
 * Managers only when their owner has flipped financials_enabled on.
 */
export function canSeeFinancials(scope: DashboardScope): boolean {
  if (scope.kind === "manager") return scope.financialsEnabled;
  return scope.kind === "normal" || scope.kind === "impersonating";
}

/**
 * Resolve the current dashboard scope.
 *
 * Most dashboard server pages want to use the result as:
 *
 *   const scope = await resolveScopedSupabase();
 *   if (scope.kind === "unauthorized") return <LoggedOut />;
 *   const { userId, client } = scope;
 *   const { data: events } = await client
 *     .from("events")
 *     .select("*")
 *     .eq("user_id", userId);
 *
 * The `client` returned is already the right shape for RLS: regular
 * cookie-authed for self/manager, service-role for impersonation. No
 * per-call branching required at the call site.
 */
export async function resolveScopedSupabase(): Promise<DashboardScope> {
  const rlsClient = await createRlsClient();
  const {
    data: { user },
  } = await rlsClient.auth.getUser();

  if (!user) {
    return { kind: "unauthorized" };
  }

  // Precedence 1: Valid impersonation by an admin whose session
  // actually owns the cookie. Anything less than this full match is
  // treated as "no impersonation" (cookie ignored silently).
  const impersonation = await getImpersonationContext();
  if (
    impersonation &&
    impersonation.adminUserId === user.id &&
    isAdmin(user)
  ) {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    return {
      kind: "impersonating",
      userId: impersonation.targetUserId,
      realUserId: user.id,
      client: serviceClient,
      isImpersonating: true,
      startedAt: impersonation.startedAt,
      expiresAt: impersonation.expiresAt,
    };
  }

  // Precedence 2: Manager viewing their owner's account.
  // Only fetch profile to check for owner_user_id. Downstream page
  // reads typically do their own (wider) profile fetch anyway.
  const { data: profile } = await rlsClient
    .from("profiles")
    .select("owner_user_id")
    .eq("id", user.id)
    .maybeSingle();
  const ownerId = (profile as { owner_user_id: string | null } | null)
    ?.owner_user_id;
  if (ownerId) {
    // Fetch the manager's Financials toggle. Default to false on any
    // failure — conservative bias keeps the owner-private money data
    // out of view if we can't verify the grant.
    const { data: membership } = await rlsClient
      .from("team_members")
      .select("financials_enabled")
      .eq("member_user_id", user.id)
      .eq("owner_user_id", ownerId)
      .eq("status", "active")
      .maybeSingle();
    const financialsEnabled =
      (membership as { financials_enabled: boolean | null } | null)
        ?.financials_enabled === true;
    return {
      kind: "manager",
      userId: ownerId,
      realUserId: user.id,
      client: rlsClient,
      isImpersonating: false,
      financialsEnabled,
    };
  }

  // Precedence 3: User viewing their own dashboard.
  return {
    kind: "normal",
    userId: user.id,
    realUserId: user.id,
    client: rlsClient,
    isImpersonating: false,
  };
}
