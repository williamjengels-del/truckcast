import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeSumUpCode,
  getSumUpMerchant,
  sumUpTokenExpiresAt,
} from "@/lib/pos/sumup";

/**
 * GET /api/pos/sumup/callback
 * Handles the OAuth callback from SumUp. Exchanges the authorization code
 * for tokens, fetches merchant info, and stores the connection.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const redirectBase = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos`;

    if (errorParam) {
      return NextResponse.redirect(
        `${redirectBase}?error=${encodeURIComponent(errorParam)}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(`${redirectBase}?error=missing_params`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== state) {
      return NextResponse.redirect(`${redirectBase}?error=auth_mismatch`);
    }

    // Exchange code for tokens
    const tokenData = await exchangeSumUpCode(code);

    // Fetch merchant info for merchant_id
    const merchant = await getSumUpMerchant(tokenData.access_token);

    // Upsert the connection
    const { error: upsertError } = await supabase
      .from("pos_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "sumup",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: sumUpTokenExpiresAt(tokenData.expires_in),
          merchant_id: merchant.merchant_code,
          location_ids: [],         // SumUp is single-merchant, no locations
          selected_location_ids: [],
          sync_enabled: true,
          last_sync_status: "never",
        },
        { onConflict: "user_id,provider" }
      );

    if (upsertError) {
      return NextResponse.redirect(
        `${redirectBase}?error=${encodeURIComponent(upsertError.message)}`
      );
    }

    return NextResponse.redirect(`${redirectBase}?success=sumup`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/pos?error=${encodeURIComponent(message)}`
    );
  }
}
