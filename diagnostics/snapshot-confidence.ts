/* eslint-disable @typescript-eslint/no-explicit-any */
// Reusable snapshot of upcoming-forecast confidence breakdown.
//
// Run:  npx tsx --env-file=.env.local diagnostics/snapshot-confidence.ts [out.json]
//
// Reproduces calculateConfidenceScore() logic inline because that function is
// not exported. Must stay in lockstep with src/lib/forecast-engine.ts — if the
// scoring math changes there, update here too.

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  calculateForecast,
  calibrateCoefficients,
  deriveEventTier,
  getVenueHistory,
  type CalibratedCoefficients,
} from "../src/lib/forecast-engine";
import type { Event } from "../src/lib/database.types";
import { getPlatformEvents } from "../src/lib/platform-registry";

const OWNER_USER_ID = "7f97040f-023d-4604-8b66-f5aa321c31de";
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

function eventRevenue(e: Event): number {
  return (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue : 0);
}
function hasRevenue(e: Event): boolean {
  return (
    (e.net_sales !== null && e.net_sales > 0) ||
    (e.event_mode === "catering" && e.invoice_revenue > 0)
  );
}
function calculateConsistency(events: Event[]): number {
  if (events.length < 2) return 0;
  const sales = events.map(eventRevenue);
  const mean = sales.reduce((a, b) => a + b, 0) / sales.length;
  if (mean === 0) return 0;
  const variance =
    sales.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sales.length;
  const stddev = Math.sqrt(variance);
  return Math.max(0, 1 - stddev / mean);
}
function detectEventFrequencyDays(events: Event[]): number {
  if (events.length < 2) return 365;
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.event_date + "T00:00:00").getTime() -
      new Date(b.event_date + "T00:00:00").getTime()
  );
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ms =
      new Date(sorted[i].event_date + "T00:00:00").getTime() -
      new Date(sorted[i - 1].event_date + "T00:00:00").getTime();
    gaps.push(ms / (1000 * 60 * 60 * 24));
  }
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

function scoreComponents(
  dataPoints: number,
  matchingEvents: Event[],
  calibrated: boolean,
  consistency: number,
  venueFamiliar: boolean,
  tierBonus: number,
  platformOperatorCount: number
) {
  const depth = Math.min(0.3, 0.3 * (Math.log2(dataPoints + 1) / Math.log2(11)));

  const freqDays = detectEventFrequencyDays(matchingEvents);
  const windowMs = Math.min(
    18 * 30 * 24 * 60 * 60 * 1000,
    Math.max(SIX_MONTHS_MS, freqDays * 1.3 * 24 * 60 * 60 * 1000)
  );
  const recentCount = matchingEvents.filter((e) => {
    const age = Date.now() - new Date(e.event_date + "T00:00:00").getTime();
    return age <= windowMs;
  }).length;
  const recency =
    matchingEvents.length > 0 ? 0.2 * (recentCount / matchingEvents.length) : 0;

  const calibration = calibrated ? 0.15 : 0;
  const consistencyScore = 0.2 * Math.max(0, consistency);
  const venue = venueFamiliar ? 0.1 : 0;
  const tier = tierBonus;
  const community =
    platformOperatorCount >= 8 ? 0.1 :
    platformOperatorCount >= 3 ? 0.05 : 0;

  const total = Math.min(
    1,
    depth + recency + calibration + consistencyScore + venue + tier + community
  );
  return { depth, recency, calibration, consistencyScore, venue, tier, community, total };
}

function getMatchingEventsForLevel(
  level: number,
  target: Partial<Event>,
  events: Event[]
): Event[] {
  switch (level) {
    case 1: {
      if (!target.event_name) return events;
      const n = target.event_name.toLowerCase().trim();
      return events.filter((e) => e.event_name.toLowerCase().trim() === n);
    }
    case 2:
      return events.filter(
        (e) =>
          e.event_type === target.event_type && e.city_area === target.city_area
      );
    case 3:
      return events.filter((e) => e.event_type === target.event_type);
    case 4: {
      if (!target.event_date) return events;
      const m = new Date(target.event_date + "T00:00:00").getMonth();
      const monthly = events.filter(
        (e) => new Date(e.event_date + "T00:00:00").getMonth() === m
      );
      return monthly.length >= 10 ? monthly : events;
    }
    default:
      return events;
  }
}

async function main() {
  const outPath = process.argv[2] ?? "diagnostics/snapshot.json";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: allEvents } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", OWNER_USER_ID)
    .order("event_date", { ascending: true });
  const events = (allEvents ?? []) as Event[];
  const today = new Date().toISOString().split("T")[0];
  const upcoming = events.filter(
    (e) => e.event_date >= today && e.booked && !e.cancellation_reason
  );
  const validEvents = events.filter(
    (e) =>
      e.booked &&
      !e.cancellation_reason &&
      hasRevenue(e) &&
      e.anomaly_flag !== "disrupted"
  );
  const calibrated: CalibratedCoefficients | null = calibrateCoefficients(events);
  const isCalibrated = calibrated !== null && calibrated.eventCount >= 10;

  const upcomingNames = [...new Set(upcoming.map((e) => e.event_name))];
  const platformMap = await getPlatformEvents(upcomingNames).catch(() => new Map());

  const rows: any[] = [];
  for (const ev of upcoming) {
    const platformEvent = platformMap.get(ev.event_name.toLowerCase().trim()) ?? null;
    const result = calculateForecast(ev, events, {
      calibratedCoefficients: calibrated,
      platformEvent,
    });
    if (!result) {
      rows.push({
        date: ev.event_date,
        name: ev.event_name,
        level: null,
        forecast: null,
        label: null,
        total: null,
        note: "no forecast",
      });
      continue;
    }
    const matching = getMatchingEventsForLevel(result.level, ev, validEvents);
    const consistency = calculateConsistency(matching);
    const venueHistory = ev.location
      ? getVenueHistory(ev.location, events)
      : null;
    // Mirror current engine tier logic: auto-derive from name-match history.
    const derivedTier = deriveEventTier(ev.event_name, events);
    const tierBonus =
      derivedTier === "A" ? 0.1 : derivedTier === "B" ? 0.05 : 0;

    const c = scoreComponents(
      result.dataPoints,
      matching,
      isCalibrated,
      consistency,
      result.venueFamiliarityApplied,
      tierBonus,
      result.platformOperatorCount ?? 0
    );

    rows.push({
      date: ev.event_date,
      name: ev.event_name,
      level: result.level,
      levelName: result.levelName,
      dataPoints: result.dataPoints,
      consistency: Number(consistency.toFixed(3)),
      venueApplied: result.venueFamiliarityApplied,
      venueCandidate: venueHistory
        ? { count: venueHistory.venueCount, consistency: Number(venueHistory.venueConsistency.toFixed(3)) }
        : null,
      storedTier: ev.event_tier,
      derivedTier,
      platformOperatorCount: result.platformOperatorCount ?? null,
      platformBlendApplied: result.platformBlendApplied,
      components: {
        depth: Number(c.depth.toFixed(3)),
        recency: Number(c.recency.toFixed(3)),
        calibration: Number(c.calibration.toFixed(3)),
        consistencyScore: Number(c.consistencyScore.toFixed(3)),
        venue: Number(c.venue.toFixed(3)),
        tier: Number(c.tier.toFixed(3)),
        community: Number(c.community.toFixed(3)),
      },
      total: Number(c.total.toFixed(3)),
      label: result.confidence,
      forecast: Math.round(result.forecast),
    });
  }

  const summary = {
    runAt: new Date().toISOString(),
    userId: OWNER_USER_ID,
    totalEvents: events.length,
    validEvents: validEvents.length,
    upcomingCount: upcoming.length,
    calibrationActive: isCalibrated,
    platformCoverage: {
      uniqueUpcomingNames: upcomingNames.length,
      withPlatformRow: platformMap.size,
    },
    levelDistribution: rows.reduce((acc: Record<string, number>, r) => {
      const k = r.level === null ? "(no forecast)" : `L${r.level}`;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    labelDistribution: rows.reduce((acc: Record<string, number>, r) => {
      const k = r.label ?? "(none)";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    venueFamiliarityFiringCount: rows.filter((r) => r.venueApplied).length,
    rows,
  };

  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`Upcoming: ${summary.upcomingCount}  |  Levels: ${JSON.stringify(summary.levelDistribution)}  |  Labels: ${JSON.stringify(summary.labelDistribution)}  |  Venue-familiarity firing: ${summary.venueFamiliarityFiringCount}/${summary.upcomingCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
