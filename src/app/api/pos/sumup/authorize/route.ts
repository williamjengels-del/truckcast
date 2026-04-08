import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import { getSumUpAuthorizeUrl } from "@/lib/pos/sumup";
import type { Profile } from "@/lib/database.types";

/**
 * GET /api/pos/sumup/authorize
 * Redirects the authenticated user to SumUp's OAuth consent page.
 * Requires Pro+ subscription tier.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !hasAccess((profile as Profile).subscription_tier, "pos_integration")
    ) {
      return NextResponse.json(
        { error: "POS integration requires a Pro or Premium subscription" },
        { status: 403 }
      );
    }

    const authorizeUrl = getSumUpAuthorizeUrl(user.id);
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
