import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recalculateForUser } from "@/lib/recalculate";

/**
 * POST /api/recalculate
 * Refresh Forecasts button + post-mutation refresh hook. Delegates to the
 * canonical recalculateForUser pipeline so this route can't drift behind
 * the lib (forecast_low/_high/_confidence writes, platform-blend fetch,
 * past-event range backfill all live there).
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await recalculateForUser(user.id);

    // Lock helper returned 'busy' — another recalc is running for this
    // user (operator double-clicked Refresh, or a Toast inbound +
    // Refresh-button collided). Surface 202 Accepted so the client can
    // tell the difference between "ran" and "skipped" and decide
    // whether to retry. Retry-After=5 because lock expiry is 5min,
    // typical recalc < 10s — 5s is a reasonable poll cadence.
    if (result.skipped) {
      return NextResponse.json(
        {
          success: false,
          skipped: true,
          detail:
            "Another recalculation is already running for your account. Try again in a few seconds.",
        },
        { status: 202, headers: { "Retry-After": "5" } }
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
