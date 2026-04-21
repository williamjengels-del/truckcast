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
  const pathname = request.nextUrl.pathname;

  // TEMP DEBUG (remove after root-cause): fires on every proxy pass so we
  // can see whether the proxy ran at all for the POS Sync POST.
  console.log("[impersonation-debug] entered proxy", {
    method,
    pathname,
  });

  if (
    method !== "POST" &&
    method !== "PATCH" &&
    method !== "PUT" &&
    method !== "DELETE"
  ) {
    return null;
  }

  const cookieValue = request.cookies.get(IMPERSONATION_COOKIE)?.value;

  // TEMP DEBUG (remove after root-cause): pins down whether the cookie is
  // arriving on mutating requests or getting dropped before the proxy.
  console.log("[impersonation-debug] cookie check", {
    method,
    pathname,
    hasCookie: !!cookieValue,
    cookieLen: cookieValue?.length ?? 0,
  });

  if (!cookieValue) return null;

  const ctx = verifyImpersonationCookie(cookieValue);

  // TEMP DEBUG (remove after root-cause): distinguishes "cookie present
  // but failed verify" (signing secret mismatch, tamper, expiry) from
  // "cookie present and valid".
  console.log("[impersonation-debug] verify result", {
    pathname,
    ctxValid: !!ctx,
  });

  if (!ctx) return null;

  const isApi = pathname.startsWith("/api/");
  const isAdminApi = pathname.startsWith("/api/admin/");
  const isServerAction = request.headers.get("next-action") !== null;

  // TEMP DEBUG (remove after root-cause): final gate decision.
  console.log("[impersonation-debug] gate decision", {
    pathname,
    isApi,
    isAdminApi,
    isServerAction,
    willBlock: (isApi && !isAdminApi) || isServerAction,
  });

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
  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/signup");

  // Protected routes — redirect to login if not authenticated
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Onboarding + trial gates — dashboard routes only
  if (user && isDashboard) {
    const isOnboardingRoute = pathname.startsWith("/dashboard/onboarding");
    const isTrialExempt = TRIAL_GATE_EXEMPT.some((p) => pathname.startsWith(p));

    // Single profile fetch covers both gates
    const { data: profile } = await supabase
      .from("profiles")
      .select("created_at, stripe_subscription_id, trial_extended_until, onboarding_completed")
      .eq("id", user.id)
      .single();

    // 1. Onboarding gate — if setup never completed, send them back to the wizard
    //    (exempt the onboarding page itself so we don't loop)
    if (profile && !profile.onboarding_completed && !isOnboardingRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard/onboarding";
      return NextResponse.redirect(url);
    }

    // 2. Trial gate — skip for exempt paths and the onboarding wizard
    if (profile && !profile.stripe_subscription_id && !isTrialExempt && !isOnboardingRoute) {
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
