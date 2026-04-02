import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeSquareCode,
  listSquareLocations,
} from "@/lib/pos/square";

/**
 * GET /api/pos/square/callback
 * Handles the OAuth callback from Square. Exchanges the authorization code
 * for tokens, fetches available locations, and stores the connection.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=${encodeURIComponent(errorParam)}`
      );
    }

    if (!code || !state) {
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

    // Exchange code for tokens
    const tokenData = await exchangeSquareCode(code);

    // Fetch available locations
    const locations = await listSquareLocations(tokenData.access_token);
    const locationIds = locations.map((l) => l.id);

    // Upsert the connection (one per user per provider)
    const { error: upsertError } = await supabase
      .from("pos_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "square",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenData.expires_at,
          merchant_id: tokenData.merchant_id,
          location_ids: locationIds,
          selected_location_ids: locationIds, // Default: all locations selected
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
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?success=square`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=${encodeURIComponent(message)}`
    );
  }
}
