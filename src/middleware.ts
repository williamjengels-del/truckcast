import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const TRIAL_DAYS = 14;

/**
 * Dashboard routes that are always accessible even after trial expiry.
 * Upgrade page + settings (so users can complete checkout).
 */
const TRIAL_GATE_EXEMPT = ["/dashboard/upgrade", "/dashboard/settings"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
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

  // Auth protection — redirect unauthenticated users away from dashboard
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

  // Trial gate — dashboard page routes only, skip exempt paths
  if (
    user &&
    isDashboard &&
    !TRIAL_GATE_EXEMPT.some((p) => pathname.startsWith(p))
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("created_at, stripe_subscription_id")
      .eq("id", user.id)
      .single();

    if (profile && !profile.stripe_subscription_id) {
      const trialEnd = new Date(
        new Date(profile.created_at).getTime() +
          TRIAL_DAYS * 24 * 60 * 60 * 1000
      );
      if (new Date() > trialEnd) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard/upgrade";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
