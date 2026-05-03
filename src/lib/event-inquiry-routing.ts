import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeCity } from "./city-normalize";

/**
 * Phase 7a routing — match an incoming public inquiry to operators.
 *
 * v1 logic (intentionally simple):
 *   - Filter to operators (owner_user_id IS NULL — exclude managers)
 *   - Onboarding completed (real operators, not abandoned signups)
 *   - City canonicalized-equality match against the inquiry's city
 *   - Optionally narrow by event_type if operator has booked it before
 *     (skipped for v1 — gets us 80% of value without complexity, and
 *     new operators with no history shouldn't be penalized)
 *
 * Returns: array of operator UUIDs to populate matched_operator_ids on
 * the inquiry. Empty array means "no operators in this city are taking
 * inquiries yet" — the inquiry still saves but won't be visible to
 * anyone until manual reroute or future expansion.
 *
 * Why client-side filter on canonicalized values:
 *   profile.city may carry either form ("St. Louis" / "Saint Louis")
 *   because the onboarding/settings forms didn't run input through
 *   canonicalizeCity historically. The same release that adds the
 *   write-side canonicalization includes a one-time SQL backfill, but
 *   between deploy and backfill (and for any rows the backfill missed)
 *   we still need a forgiving server-side equality check. Pulling the
 *   short list of onboarded operators and filtering in JS is cheap —
 *   counts in the hundreds, not millions — and removes the SQL-level
 *   spelling sensitivity entirely.
 *
 * Future iterations (Phase 7e):
 *   - Distance-based (within X miles via lat/lng)
 *   - Forecast-based (operators whose forecast suggests they'd perform
 *     well at this event_type / size)
 *   - Reputation-based (response rate / claim rate from prior inquiries)
 */
export async function matchOperatorsForInquiry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: SupabaseClient<any, any, any>,
  city: string,
  // event_type captured for future use when we narrow by historical
  // booking patterns; unused in v1 routing logic.
  _event_type: string
): Promise<string[]> {
  void _event_type;
  const targetCanon = canonicalizeCity(city);
  if (!targetCanon) return [];

  const { data, error } = await service
    .from("profiles")
    .select("id, city")
    .eq("onboarding_completed", true)
    .is("owner_user_id", null);

  if (error || !data) return [];
  return (data as { id: string; city: string | null }[])
    .filter((r) => canonicalizeCity(r.city) === targetCanon)
    .map((r) => r.id);
}
