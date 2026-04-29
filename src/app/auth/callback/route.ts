import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Ensure profile row exists — trigger may not have fired (e.g. OAuth, email confirm)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").upsert(
          { id: user.id, subscription_tier: "starter" },
          { onConflict: "id", ignoreDuplicates: true }
        );

        // Record login event for new-device email notifications. The
        // recording endpoint owns the geo / IP / UA extraction and
        // the email send — we just trigger it. Fire-and-forget; this
        // route returns the redirect regardless of recording outcome.
        const recordUrl = new URL("/api/auth/record-login", origin);
        void fetch(recordUrl, {
          method: "POST",
          headers: {
            // Forward the original cookies so the recording endpoint
            // sees the now-valid session.
            cookie: request.headers.get("cookie") ?? "",
            // Forward UA + IP-equivalent headers — the recording
            // endpoint reads x-forwarded-for + user-agent.
            "user-agent": request.headers.get("user-agent") ?? "",
            "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
          },
        }).catch(() => undefined);
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
