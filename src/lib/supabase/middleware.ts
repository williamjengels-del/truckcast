import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

export async function updateSession(request: NextRequest) {
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

  // Trial gate — dashboard routes only, skip exempt paths (upgrade, settings, admin)
  if (
    user &&
    isDashboard &&
    !TRIAL_GATE_EXEMPT.some((p) => pathname.startsWith(p))
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("created_at, stripe_subscription_id, trial_extended_until")
      .eq("id", user.id)
      .single();

    if (profile && !profile.stripe_subscription_id) {
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
