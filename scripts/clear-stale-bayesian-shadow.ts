// One-off: clear stale forecast_bayesian_* values for past events so
// the next recalc backfills them with the post-cleanup data (cleaner
// city/state, weather_cache populated, cancellation flags applied).
//
// Future events are NOT touched — recalc rewrites them every cycle.
// Only past events with stored shadow values get cleared, so the
// recalc-pipeline's "past events missing v2" backfill loop picks
// them up.
import { createClient } from "@supabase/supabase-js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/_clear-stale-bayesian-shadow.ts <user-id>");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const today = new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await sb
    .from("events")
    .select("id")
    .eq("user_id", userId)
    .lt("event_date", today)
    .not("forecast_bayesian_point", "is", null);
  if (error) throw error;
  console.log("Past events with shadow values to clear:", (rows ?? []).length);
  if ((rows ?? []).length === 0) return;

  const { error: upErr } = await sb
    .from("events")
    .update({
      forecast_bayesian_point: null,
      forecast_bayesian_low_80: null,
      forecast_bayesian_high_80: null,
      forecast_bayesian_low_50: null,
      forecast_bayesian_high_50: null,
      forecast_bayesian_n_obs: null,
      forecast_bayesian_prior_src: null,
      forecast_bayesian_insufficient: null,
      forecast_bayesian_computed_at: null,
    })
    .eq("user_id", userId)
    .lt("event_date", today)
    .not("forecast_bayesian_point", "is", null);
  if (upErr) throw upErr;
  console.log("Cleared. Run scripts/_trigger-recalc.ts to repopulate.");
}
