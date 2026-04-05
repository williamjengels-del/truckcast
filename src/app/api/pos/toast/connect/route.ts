import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/subscription";
import type { Profile } from "@/lib/database.types";

/**
 * POST /api/pos/toast/connect
 * Enables Toast email parsing for the authenticated user.
 * Creates a pos_connections row with provider='toast'.
 * No OAuth — the access_token field stores a marker value.
 *
 * Body: { businessName: string }
 */
export async function POST(request: Request) {
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

    if (!profile || !hasAccess((profile as Profile).subscription_tier, "pos_integration")) {
      return NextResponse.json(
        { error: "POS integration requires a Pro or Premium subscription" },
        { status: 403 }
      );
    }

    const { businessName } = await request.json();

    if (!businessName?.trim()) {
      return NextResponse.json(
        { error: "Business name is required" },
        { status: 400 }
      );
    }

    // Upsert: if they re-connect, update the business name
    const { error } = await supabase.from("pos_connections").upsert(
      {
        user_id: user.id,
        provider: "toast",
        // access_token stores the business name prefix used in Toast email subjects
        access_token: "email_parsing_enabled",
        merchant_id: businessName.trim(),
        sync_enabled: true,
        last_sync_status: "never",
      },
      { onConflict: "user_id,provider" }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
