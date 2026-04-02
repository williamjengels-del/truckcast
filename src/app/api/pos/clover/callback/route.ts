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
          refresh_token: null, // Clover tokens don't expire in the same way
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
