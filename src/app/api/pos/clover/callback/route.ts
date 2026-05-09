import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCloverCode } from "@/lib/pos/clover";

/**
 * GET /api/pos/clover/callback
 * Handles the OAuth callback from Clover. Exchanges the authorization code
 * for an access token and stores the connection.
 *
 * Clover passes merchant_id as a query parameter in the callback URL.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const merchantId = url.searchParams.get("merchant_id");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=${encodeURIComponent(errorParam)}`
      );
    }

    if (!code || !state || !merchantId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=missing_params`
      );
    }

    // Verify the user is authenticated and state matches
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=auth_mismatch`
      );
    }

    // Exchange code for access token
    const tokenData = await exchangeCloverCode(code);

    // Upsert the connection
    const { error: upsertError } = await supabase
      .from("pos_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "clover",
          access_token: tokenData.access_token,
          // Clover access tokens DO expire (~13 months from issue). We
          // don't have a refresh_token because Clover's third-party app
          // OAuth flow doesn't return one — the recovery path is a
          // full reconnect via this callback. The 401-detect in
          // src/lib/pos/clover.ts surfaces the expiry as
          // last_sync_status=auth_expired so the operator sees a
          // "Reconnect Clover" affordance in /dashboard/integrations.
          refresh_token: null,
          token_expires_at: null,
          merchant_id: merchantId,
          location_ids: [merchantId], // Clover uses merchant_id as the location
          selected_location_ids: [merchantId],
          sync_enabled: true,
          last_sync_status: "never",
        },
        { onConflict: "user_id,provider" }
      );

    if (upsertError) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=${encodeURIComponent(upsertError.message)}`
      );
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?success=clover`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=${encodeURIComponent(message)}`
    );
  }
}
