/**
 * Organizer quality scoring (Premium feature).
 *
 * Scores an event organizer on a 0–10 scale based on the historical
 * performance of the events they run. Users link event names to contacts;
 * the score is derived from the event_performance records for those events.
 *
 * Score components:
 *   - Revenue index (0–4 pts): how their avg sales compare to the user's
 *     overall average across all events.
 *   - Consistency (0–3 pts): avg consistency_score from event_performance
 *     (consistency_score is already 0–1).
 *   - Trend bonus (0–2 pts): Growing +2, Stable +1, Declining 0,
 *     New/Insufficient 0.5 (partial credit)
 *   - Coverage bonus (0–1 pt): having ≥3 linked events = 1 pt, 2 = 0.5, 1 = 0.
 *
 * Total: 0–10, rounded to 1 decimal place.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrganizerScoreBreakdown {
  contactId: string;
  score: number;
  revenueIndex: number;
  consistencyPts: number;
  trendPts: number;
  coveragePts: number;
  linkedEventCount: number;
  avgSales: number;
  dominantTrend: string;
}

export async function calculateOrganizerScore(
  supabase: SupabaseClient,
  userId: string,
  linkedEventNames: string[]
): Promise<Omit<OrganizerScoreBreakdown, "contactId"> | null> {
  if (!linkedEventNames || linkedEventNames.length === 0) return null;

  // Fetch event_performance rows for linked events
  const { data: perfs } = await supabase
    .from("event_performance")
    .select("avg_sales, consistency_score, trend, times_booked")
    .eq("user_id", userId)
    .in("event_name", linkedEventNames);

  if (!perfs || perfs.length === 0) return null;

  // Fetch user's overall average sales for normalization
  const { data: allPerfs } = await supabase
    .from("event_performance")
    .select("avg_sales")
    .eq("user_id", userId);

  const overallAvg =
    allPerfs && allPerfs.length > 0
      ? allPerfs.reduce((sum, p) => sum + (p.avg_sales ?? 0), 0) /
        allPerfs.length
      : 1;

  // Revenue index (0–4): ratio of organizer avg to overall avg, capped at 2x
  const organizerAvgSales =
    perfs.reduce((sum, p) => sum + (p.avg_sales ?? 0), 0) / perfs.length;
  const revenueRatio = overallAvg > 0 ? organizerAvgSales / overallAvg : 1;
  const revenueIndex = Math.min(4, parseFloat((revenueRatio * 2).toFixed(1)));

  // Consistency (0–3)
  const avgConsistency =
    perfs.reduce((sum, p) => sum + (p.consistency_score ?? 0), 0) /
    perfs.length;
  const consistencyPts = parseFloat((avgConsistency * 3).toFixed(1));

  // Trend bonus (0–2): use the most common trend among linked events
  const trendCounts: Record<string, number> = {};
  for (const p of perfs) {
    trendCounts[p.trend] = (trendCounts[p.trend] ?? 0) + 1;
  }
  const dominantTrend = Object.entries(trendCounts).sort(
    ([, a], [, b]) => b - a
  )[0][0];

  const trendPts =
    dominantTrend === "Growing"
      ? 2
      : dominantTrend === "Stable"
        ? 1
        : dominantTrend === "New/Insufficient Data"
          ? 0.5
          : 0;

  // Coverage bonus (0–1)
  const coveragePts =
    perfs.length >= 3 ? 1 : perfs.length === 2 ? 0.5 : 0;

  const score = parseFloat(
    Math.min(10, revenueIndex + consistencyPts + trendPts + coveragePts).toFixed(1)
  );

  return {
    score,
    revenueIndex,
    consistencyPts,
    trendPts,
    coveragePts,
    linkedEventCount: perfs.length,
    avgSales: parseFloat(organizerAvgSales.toFixed(2)),
    dominantTrend,
  };
}
