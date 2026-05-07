#!/usr/bin/env node
// Identify past booked events that look like weather cancellations:
// near-zero net_sales on a date when weather_cache shows heavy
// precipitation. Operator's example (2026-05-07): Forest Park Balloon
// Race Saturday — Friday did $5K, Saturday cancelled due to intense
// storms, currently shows $0 with no cancellation_reason set, so it
// counts as a 100%-miss against forecast accuracy.
//
// Two outputs:
//   1. CANCELLATION_CANDIDATE — net_sales is null or <= $50 AND
//      weather shows precipitation_in >= 0.75". Likely a true
//      weather cancellation. Proposed fix: cancellation_reason="weather".
//   2. DISRUPTION_CANDIDATE — net_sales > $50 but < 30% of operator
//      typical AND weather shows precipitation_in >= 0.5". Event
//      happened but got rained on. Proposed fix: anomaly_flag="disrupted".
//
// READ-ONLY by default. Pass --apply to write. Operator confirms the
// dry-run TSV per the no-auto-fix rule before --apply runs.
//
// Usage:
//   export $(grep -v '^#' .env.local | xargs)
//   npx tsx scripts/flag-weather-cancellations.ts <user-id>           # dry-run
//   npx tsx scripts/flag-weather-cancellations.ts <user-id> --apply   # writes

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import type { Event } from "../src/lib/database.types.ts";

const userId = process.argv[2];
const apply = process.argv.includes("--apply");
const outputPath = "./weather-cancellation-proposals.tsv";

if (!userId) {
  console.error("Usage: npx tsx scripts/flag-weather-cancellations.ts <user-id> [--apply]");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const today = new Date().toISOString().slice(0, 10);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

interface Candidate {
  eventId: string;
  eventDate: string;
  eventName: string;
  netSales: number | null;
  maxTempF: number | null;
  precipitationIn: number | null;
  weather: string | null;
  classification: "CANCELLATION_CANDIDATE" | "DISRUPTION_CANDIDATE";
  proposedCancellationReason: "weather" | null;
  proposedAnomalyFlag: "disrupted" | null;
}

async function main() {
  // Pull operator's median revenue for a baseline comparison.
  const { data: pastEvents, error } = await supabase
    .from("events")
    .select("id, event_date, event_name, net_sales, latitude, longitude, event_weather, cancellation_reason, anomaly_flag")
    .eq("user_id", userId)
    .eq("booked", true)
    .lt("event_date", today);
  if (error) throw error;
  const allPast = (pastEvents ?? []) as Pick<
    Event,
    | "id"
    | "event_date"
    | "event_name"
    | "net_sales"
    | "latitude"
    | "longitude"
    | "event_weather"
    | "cancellation_reason"
    | "anomaly_flag"
  >[];

  // Operator typical (median of non-zero past events with no anomaly).
  const validPositive = allPast
    .filter((e) => (e.net_sales ?? 0) > 0 && e.anomaly_flag !== "disrupted")
    .map((e) => e.net_sales!)
    .sort((a, b) => a - b);
  const operatorMedian =
    validPositive.length > 0
      ? validPositive[Math.floor(validPositive.length / 2)]
      : 0;
  console.log(`\nOperator median revenue: $${operatorMedian.toFixed(0)}`);
  console.log(`Past booked events to check: ${allPast.length}`);

  // For each candidate, fetch its weather_cache row. We check TWO
  // adverse-weather signals: (a) event_weather column (manually set
  // or auto-classified at the time, e.g. "Storms" / "Snow") and (b)
  // weather_cache.precipitation_in. Either alone counts — Forest Park
  // Balloon Race Saturday 2025-09-20 had event_weather="Storms"
  // matching operator's recollection of intense storms, but the
  // daily Open-Meteo total only registered 0.09" because the peak
  // missed the daily aggregation window. Trusting both sources
  // catches that case.
  const ADVERSE_WEATHER_TYPES = new Set(["Storms", "Snow", "Rain During Event"]);
  const candidates: Candidate[] = [];
  for (const e of allPast) {
    // Skip if already flagged.
    if (e.cancellation_reason) continue;
    if (e.anomaly_flag === "disrupted") continue;

    const ns = e.net_sales;
    // Cancellation: clearly low or null net_sales. Threshold raised
    // to $100 to catch "showed up briefly then weather cancelled
    // mid-event" cases (operator reported $79 on Forest Park
    // Saturday cancellation).
    const isCancellationCandidate = ns == null || ns <= 100;
    const isDisruptionCandidate =
      ns != null && ns > 100 && operatorMedian > 0 && ns < 0.3 * operatorMedian;
    if (!isCancellationCandidate && !isDisruptionCandidate) continue;

    if (e.latitude == null || e.longitude == null) continue;

    const { data: cache } = await supabase
      .from("weather_cache")
      .select("max_temp_f, precipitation_in, weather_classification")
      .eq("date", e.event_date)
      .gte("latitude", e.latitude - 0.1)
      .lte("latitude", e.latitude + 0.1)
      .gte("longitude", e.longitude - 0.1)
      .lte("longitude", e.longitude + 0.1)
      .maybeSingle();

    const precip = cache?.precipitation_in ?? 0;
    const eventWeatherAdverse = e.event_weather
      ? ADVERSE_WEATHER_TYPES.has(e.event_weather)
      : false;
    const cacheWeatherStorms =
      cache?.weather_classification === "Storms" ||
      cache?.weather_classification === "Snow";

    // Either signal counts. Cancellation requires a stronger signal
    // (heavy precip OR Storms classification); disruption is more
    // permissive (medium precip OR adverse weather type).
    const isCancelStorm = precip >= 0.75 || cacheWeatherStorms || eventWeatherAdverse;
    const isDisruptStorm =
      precip >= 0.5 ||
      eventWeatherAdverse ||
      cache?.weather_classification === "Rain During Event";

    if (isCancellationCandidate && isCancelStorm) {
      candidates.push({
        eventId: e.id,
        eventDate: e.event_date,
        eventName: e.event_name,
        netSales: ns,
        maxTempF: cache?.max_temp_f ?? null,
        precipitationIn: precip,
        weather: cache?.weather_classification ?? e.event_weather ?? null,
        classification: "CANCELLATION_CANDIDATE",
        proposedCancellationReason: "weather",
        proposedAnomalyFlag: null,
      });
    } else if (isDisruptionCandidate && isDisruptStorm) {
      candidates.push({
        eventId: e.id,
        eventDate: e.event_date,
        eventName: e.event_name,
        netSales: ns,
        maxTempF: cache?.max_temp_f ?? null,
        precipitationIn: precip,
        weather: cache?.weather_classification ?? e.event_weather ?? null,
        classification: "DISRUPTION_CANDIDATE",
        proposedCancellationReason: null,
        proposedAnomalyFlag: "disrupted",
      });
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`PROPOSED FLAGS — ${candidates.length} candidates`);
  console.log("=".repeat(70));
  const cCount = candidates.filter((c) => c.classification === "CANCELLATION_CANDIDATE").length;
  const dCount = candidates.filter((c) => c.classification === "DISRUPTION_CANDIDATE").length;
  console.log(`  CANCELLATION_CANDIDATE (net≤$50, precip≥0.75"):  ${cCount}`);
  console.log(`  DISRUPTION_CANDIDATE   (net<30% median, precip≥0.5"): ${dCount}`);

  if (candidates.length > 0) {
    console.log(`\n--- All candidates ---`);
    for (const c of candidates) {
      console.log(
        `  ${c.eventDate}  net=${c.netSales == null ? "null" : "$" + c.netSales}  ` +
          `precip=${c.precipitationIn?.toFixed(2)}"  temp=${c.maxTempF}°F  ` +
          `[${c.classification}]  ${c.eventName.slice(0, 50)}`
      );
    }
  }

  // Write TSV.
  const headers = [
    "event_id",
    "event_date",
    "event_name",
    "net_sales",
    "max_temp_f",
    "precipitation_in",
    "weather_classification",
    "classification",
    "proposed_cancellation_reason",
    "proposed_anomaly_flag",
  ];
  const lines = [
    headers.join("\t"),
    ...candidates.map((c) =>
      [
        c.eventId,
        c.eventDate,
        c.eventName,
        c.netSales ?? "",
        c.maxTempF ?? "",
        c.precipitationIn ?? "",
        c.weather ?? "",
        c.classification,
        c.proposedCancellationReason ?? "",
        c.proposedAnomalyFlag ?? "",
      ]
        .map((v) => String(v).replace(/\t/g, " "))
        .join("\t")
    ),
  ];
  writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nFull TSV at ${outputPath}`);

  if (!apply) {
    console.log(`\n${"=".repeat(70)}`);
    console.log("DRY RUN — no records modified.");
    console.log("Review candidates above. These touch operator data, so the");
    console.log("--apply path requires explicit confirmation in the chat.");
    console.log("=".repeat(70));
    return;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`APPLYING ${candidates.length} CHANGES`);
  console.log("=".repeat(70));

  let updated = 0;
  let failed = 0;
  for (const c of candidates) {
    const update: Record<string, unknown> = {};
    if (c.proposedCancellationReason)
      update.cancellation_reason = c.proposedCancellationReason;
    if (c.proposedAnomalyFlag) update.anomaly_flag = c.proposedAnomalyFlag;
    const { error: upErr } = await supabase
      .from("events")
      .update(update)
      .eq("id", c.eventId)
      .eq("user_id", userId);
    if (upErr) {
      console.error(`  FAILED ${c.eventId} (${c.eventName}): ${upErr.message}`);
      failed++;
    } else {
      updated++;
    }
  }
  console.log(`\nUpdated: ${updated}  Failed: ${failed}`);
}
