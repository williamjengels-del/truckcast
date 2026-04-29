import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  recordLogin,
  formatLocation,
  summarizeUserAgent,
  markNotificationSent,
} from "@/lib/login-events";
import { sendNewDeviceLoginEmail } from "@/lib/email";

/**
 * POST /api/auth/record-login
 *
 * Called from:
 *   - src/app/(auth)/login/page.tsx — after supabase.auth.signInWithPassword
 *     resolves successfully. Client-initiated.
 *   - src/app/auth/callback/route.ts — after exchangeCodeForSession
 *     resolves successfully (OAuth path). Server-side.
 *
 * Both paths converge on this endpoint so the recording + new-device
 * detection + email send live in one place.
 *
 * The endpoint NEVER blocks the login flow. Recording failures and
 * email send failures are caught + Sentry'd; the response is still
 * 200 so the client redirect can proceed.
 *
 * Geo (city, country) comes from Vercel's request.geo extension (set
 * on NextRequest in production). We pass through `null` in dev/local
 * where geo isn't available.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // Unauthenticated probe — bounce. The recording endpoint requires
      // a valid session (the caller is expected to call this only AFTER
      // a successful sign-in, when the cookie is set).
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;
    // Vercel attaches geo to NextRequest in production; in dev/local
    // these fields are undefined. Treat as missing.
    type WithGeo = NextRequest & {
      geo?: { city?: string; country?: string } | undefined;
    };
    const geo = (req as WithGeo).geo;
    const city = geo?.city ?? null;
    const country = geo?.country ?? null;

    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const result = await recordLogin(service, {
      userId: user.id,
      ip,
      userAgent,
      country,
      city,
    });

    // Fire the new-device email when this isn't the user's first login
    // and the (ip, ua) combo wasn't seen recently. Don't await the
    // send — it shouldn't extend the response time.
    if (result.isNewDevice && !result.isFirstLogin && result.loginEventId) {
      const email = user.email;
      if (email) {
        const { data: profile } = await service
          .from("profiles")
          .select("business_name")
          .eq("id", user.id)
          .maybeSingle();
        const businessName =
          (profile as { business_name?: string | null } | null)
            ?.business_name ?? null;

        // Fire-and-forget — login flow shouldn't wait for SMTP.
        (async () => {
          try {
            await sendNewDeviceLoginEmail({
              to: email,
              businessName,
              deviceSummary: summarizeUserAgent(userAgent),
              locationLabel: formatLocation(city, country),
              userAgent: userAgent ?? "(unknown)",
              ip: ip ?? "(unknown)",
              signedInAt: new Date().toISOString(),
            });
            await markNotificationSent(service, result.loginEventId!);
          } catch (err) {
            console.error("[record-login] new-device email failed", err);
            Sentry.captureException(err, {
              tags: { source: "record_login_email" },
            });
          }
        })();
      }
    }

    // Suppress repeat detection on a single login by also returning
    // the freshly-recorded row's id — useful for debugging.
    return NextResponse.json({
      ok: true,
      first_login: result.isFirstLogin,
      new_device: result.isNewDevice,
      login_event_id: result.loginEventId,
    });
  } catch (err) {
    console.error("[record-login] error", err);
    Sentry.captureException(err, { tags: { source: "record_login_api" } });
    // Critical: do NOT return non-2xx — the login flow is allowed to
    // continue regardless of telemetry failures.
    return NextResponse.json(
      { ok: false, error: "Recording skipped" },
      { status: 200 }
    );
  }
}

