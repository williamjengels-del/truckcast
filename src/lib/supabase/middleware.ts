import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "@/lib/admin-impersonation";

const TRIAL_DAYS = 14;

/**
 * Hard gate date — before this date, expired-trial users can still access
 * the dashboard (they only see the banner). On or after this date, they're
 * redirected to /dashboard/upgrade until they subscribe.
 */
const HARD_GATE_DATE = new Date("2026-05-01T00:00:00Z");

/**
 * Dashboard routes that are always accessible even after trial expiry
 * so users can upgrade or change settings without being locked out.
 */
const TRIAL_GATE_EXEMPT = [
  "/dashboard/upgrade",
  "/dashboard/settings",
  "/dashboard/admin",
];

/**
 * Owner-only dashboard routes — bounce managers to /dashboard.
 *
 *   - /dashboard/insights — analytics + reports (revenue-heavy)
 *   - /dashboard/integrations — POS connections + CSV import (data
 *     ingestion is owner-controlled)
 *   - /dashboard/forecasts — forecasting calculator (financial)
 *   - /dashboard/onboarding — owner-only (managers run a separate
 *     accept-invite flow at /dashboard/team/accept)
 *   - /dashboard/upgrade — billing surface
 *
 * /dashboard/admin is gated separately by the admin allowlist; not
 * listed here because admins aren't managers (they're a disjoint set
 * — admin allowlist is by email, manager state is by team_members).
 */
const MANAGER_BLOCKED_PATHS = [
  "/dashboard/insights",
  "/dashboard/integrations",
  "/dashboard/forecasts",
  "/dashboard/onboarding",
  "/dashboard/upgrade",
];

/**
 * Returns a 403 response when the request is a mutation under an active
 * impersonation session, null otherwise. Runs as the very first gate in
 * updateSession — cheap cookie-presence check, no DB/auth work needed
 * to make the decision.
 *
 * Block rules:
 *   * Mutating method (POST / PATCH / PUT / DELETE)
 *   * A signed + non-expired vc_impersonate cookie is present
 *   * Path is either:
 *       - /api/* EXCEPT /api/admin/* (admin routes must keep working so
 *         the admin can stop impersonation and use admin tools), OR
 *       - A server action (any POST carrying the `Next-Action` header —
 *         canonical signal per Next.js 16's server action dispatch)
 *
 * Intentional non-blocks:
 *   * POS webhooks (Toast via Cloudflare Worker, Square direct) send
 *     their own auth, not our cookies. They never carry vc_impersonate,
 *     so the cookie-presence check returns null for them and they pass
 *     straight through. Verified: see /api/pos/toast/inbound and
 *     /api/pos/square/callback — both are webhook-style POSTs without
 *     user cookies.
 *   * Forged or expired cookies. If verifyImpersonationCookie returns
 *     null the request is NOT considered "under impersonation" and the
 *     block does not activate. That's correct — a mutation with a
 *     stale cookie should behave exactly like a mutation without one.
 */
function maybeBlockMutationUnderImpersonation(
  request: NextRequest
): NextResponse | null {
  const method = request.method;
  if (
    method !== "POST" &&
    method !== "PATCH" &&
    method !== "PUT" &&
    method !== "DELETE"
  ) {
    return null;
  }

  const cookieValue = request.cookies.get(IMPERSONATION_COOKIE)?.value;
  if (!cookieValue) return null;

  const ctx = verifyImpersonationCookie(cookieValue);
  if (!ctx) return null;

  const pathname = request.nextUrl.pathname;

  const isApi = pathname.startsWith("/api/");
  const isAdminApi = pathname.startsWith("/api/admin/");
  const isServerAction = request.headers.get("next-action") !== null;

  if (isApi && !isAdminApi) {
    return blockedResponse();
  }
  if (isServerAction) {
    return blockedResponse();
  }
  return null;
}

function blockedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Read-only impersonation active",
      detail:
        "This browser session is viewing another user's dashboard in read-only mode. Mutations are blocked. Exit impersonation to resume normal operation.",
    },
    {
      status: 403,
      headers: { "x-impersonation-blocked": "1" },
    }
  );
}

export async function updateSession(request: NextRequest) {
  // ── Read-only impersonation mutation block (Commit 5b) ────────────
  // Runs before auth gates because the decision is a pure
  // cookie-presence + method + path check. No Supabase round-trip
  // needed to reject these.
  const impersonationBlock = maybeBlockMutationUnderImpersonation(request);
  if (impersonationBlock) return impersonationBlock;

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const method = request.method;
  const isDashboard = pathname.startsWith("/dashboard");
  const isLogin2fa = pathname.startsWith("/login/2fa");
  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isApi = pathname.startsWith("/api/");
  const isMfaApi = pathname.startsWith("/api/auth/mfa/");
  const isMutation =
    method === "POST" ||
    method === "PATCH" ||
    method === "PUT" ||
    method === "DELETE";
  const isServerAction = request.headers.get("next-action") !== null;

  // Protected routes — redirect to login if not authenticated
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // ── AAL (Authenticator Assurance Level) gate ──────────────────────
  // For users with TOTP enrolled, the password-only session is AAL1.
  // After a successful TOTP challenge it becomes AAL2. Any user with
  // an enrolled+verified factor must be at AAL2 to reach /dashboard
  // OR perform any mutation (API or server action).
  //
  // /login/2fa is the challenge surface — it must remain reachable for
  // AAL1 users with a factor, otherwise the only way out is logout.
  // /api/auth/mfa/* exposes the challenge endpoints themselves; they
  // necessarily run at AAL1 and self-elevate the session, so they're
  // exempt from the API mutation gate.
  //
  // For users without an enrolled factor, getAuthenticatorAssuranceLevel
  // returns nextLevel === 'aal1' (no step-up needed) and the gate is a
  // no-op. Cost: one JWT-claim read per request — Supabase doesn't
  // round-trip to the DB for this.
  async function aalNeedsStepUp(): Promise<boolean> {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.currentLevel === "aal1" && data?.nextLevel === "aal2";
  }

  // API + server action mutation gate. Returns 403 (no redirect — the
  // caller is fetch/server-action machinery, not a navigating browser).
  // Mirror the impersonation-block shape so the operational story is
  // consistent across both gates.
  if (
    user &&
    ((isApi && isMutation && !isMfaApi) || isServerAction) &&
    (await aalNeedsStepUp())
  ) {
    return NextResponse.json(
      {
        error: "Two-factor verification required",
        detail:
          "Your session must complete the two-factor challenge before performing this action.",
      },
      {
        status: 403,
        headers: { "x-aal-required": "aal2" },
      }
    );
  }

  // Redirect authenticated users away from auth pages — but route
  // password-authenticated users with a factor to /login/2fa first
  // instead of bouncing through /dashboard.
  if (user && isAuthRoute && !isLogin2fa) {
    const url = request.nextUrl.clone();
    url.pathname = (await aalNeedsStepUp()) ? "/login/2fa" : "/dashboard";
    return NextResponse.redirect(url);
  }

  // /login/2fa for already-AAL2 users: bounce to dashboard so refreshing
  // the challenge page doesn't get stuck.
  if (user && isLogin2fa && !(await aalNeedsStepUp())) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Dashboard AAL2 enforcement — must come before onboarding/trial gates
  // so an AAL1 session never reaches the trial-gate profile fetch.
  if (user && isDashboard && (await aalNeedsStepUp())) {
    const url = request.nextUrl.clone();
    url.pathname = "/login/2fa";
    return NextResponse.redirect(url);
  }

  // Onboarding + trial gates — dashboard routes only
  if (user && isDashboard) {
    const isOnboardingRoute = pathname.startsWith("/dashboard/onboarding");
    const isTrialExempt = TRIAL_GATE_EXEMPT.some((p) => pathname.startsWith(p));

    // Single profile fetch covers all dashboard gates (onboarding,
    // trial, manager owner-only-route block).
    const { data: profile } = await supabase
      .from("profiles")
      .select("created_at, stripe_subscription_id, trial_extended_until, onboarding_completed, owner_user_id")
      .eq("id", user.id)
      .single();

    // Owner-only-route gate. If this user is a manager (owner_user_id
    // is set) and the path is on the block list, send them to the
    // dashboard root. Sidebar already hides these links for managers
    // (sidebar.tsx filter), but URL-bar navigation still reaches the
    // page without a server-side block.
    if (profile?.owner_user_id) {
      const blocked = MANAGER_BLOCKED_PATHS.some((p) => pathname.startsWith(p));
      if (blocked) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }
    }

    // 1. Onboarding gate — if setup never completed, send them back to
    //    the wizard (exempt the onboarding page itself so we don't loop).
    //
    //    Managers are exempt entirely. The /dashboard/team/accept flow
    //    normalizes manager profiles with onboarding_completed=false
    //    on purpose (so they can never accidentally complete the
    //    operator wizard), and /dashboard/onboarding itself is on
    //    MANAGER_BLOCKED_PATHS — so without this exemption the gate
    //    bounces them between /dashboard and /dashboard/onboarding
    //    forever (browser-side ERR_TOO_MANY_REDIRECTS). Surfaced
    //    2026-05-04 when Rohini hit the loop on real login.
    if (
      profile &&
      !profile.onboarding_completed &&
      !isOnboardingRoute &&
      !profile.owner_user_id
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard/onboarding";
      return NextResponse.redirect(url);
    }

    // 2. Trial gate — skip for exempt paths, the onboarding wizard,
    //    and managers (they don't have a subscription of their own —
    //    the owner pays).
    if (
      profile &&
      !profile.stripe_subscription_id &&
      !isTrialExempt &&
      !isOnboardingRoute &&
      !profile.owner_user_id
    ) {
      const now = new Date();

      // Admin-granted trial extension takes priority over created_at calculation
      if (profile.trial_extended_until && new Date(profile.trial_extended_until) > now) {
        // Extended trial still active — allow through
      } else {
        const trialEnd = new Date(
          new Date(profile.created_at).getTime() +
            TRIAL_DAYS * 24 * 60 * 60 * 1000
        );
        if (now > trialEnd && now >= HARD_GATE_DATE) {
          // Hard gate only enforces on or after HARD_GATE_DATE.
          // Before that date, expired-trial users see the dashboard banner instead.
          const url = request.nextUrl.clone();
          url.pathname = "/dashboard/upgrade";
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return supabaseResponse;
}
