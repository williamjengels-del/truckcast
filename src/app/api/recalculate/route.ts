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
