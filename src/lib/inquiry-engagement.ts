/**
 * Marketplace inquiry engagement signal.
 *
 * Returns a soft, qualitative copy string indicating how active an
 * inquiry is among matched operators — without exposing exact counts,
 * competitor identities, or countdown anxiety. Operator-side only,
 * never surfaced to organizers.
 *
 * Engagement bucket = operators whose operator_actions slot has
 * action="claimed" OR action="contacted". "Not interested" doesn't
 * count. The viewing operator's own status counts toward the total.
 *
 * Tier copy + threshold values are intentionally factored here so a
 * future PR can swap them via remote config without touching render
 * code. When operator density grows enough that exact counts feel
 * less anxiety-inducing than soft copy, the same swap point lets us
 * trade copy for a "N interested" string.
 */

export interface EngagementTier {
  /** Inclusive lower bound on engaged count. */
  min: number;
  /** Inclusive upper bound on engaged count. Use Infinity for the top tier. */
  max: number;
  /** Display string. Null suppresses rendering for this tier. */
  copy: string | null;
}

export const ENGAGEMENT_TIERS: readonly EngagementTier[] = [
  // Below 2 engaged operators: silence. Showing "1 operator interested"
  // (or worse, "be the first") creates cold-start sadness and isn't
  // useful triage signal.
  { min: 0, max: 1, copy: null },
  { min: 2, max: 2, copy: "On a few operators' radars" },
  { min: 3, max: 4, copy: "Picking up steam" },
  { min: 5, max: Infinity, copy: "Drawing real interest" },
];

export function engagementCopyFor(engagedCount: number): string | null {
  if (engagedCount < 0 || !Number.isFinite(engagedCount)) return null;
  for (const tier of ENGAGEMENT_TIERS) {
    if (engagedCount >= tier.min && engagedCount <= tier.max) return tier.copy;
  }
  return null;
}

/**
 * Counts operators with action "claimed" or "contacted" in the
 * operator_actions jsonb. Defensively coerces shape — a malformed
 * slot returns 0 contribution rather than throwing.
 */
export function countEngagedOperators(
  operatorActions: Record<string, unknown> | null | undefined
): number {
  if (!operatorActions || typeof operatorActions !== "object") return 0;
  let n = 0;
  for (const slot of Object.values(operatorActions)) {
    if (!slot || typeof slot !== "object") continue;
    const action = (slot as { action?: unknown }).action;
    if (action === "claimed" || action === "contacted") n += 1;
  }
  return n;
}

/**
 * Convenience: combines suppression rules + count + copy lookup. An
 * inquiry past its event_date or with status="expired" returns null
 * regardless of engagement count — the lead is gone, the signal would
 * just be noise.
 */
export function engagementSignalForInquiry(args: {
  operatorActions: Record<string, unknown> | null | undefined;
  eventDate: string; // YYYY-MM-DD
  status: string;
  todayIso: string; // YYYY-MM-DD; injected so tests are deterministic
}): string | null {
  if (args.status === "expired") return null;
  if (args.eventDate < args.todayIso) return null;
  return engagementCopyFor(countEngagedOperators(args.operatorActions));
}
