import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import { recalculateForUserWithClient } from "@/lib/recalculate-service";
import {
  matchFeeType,
  parseWithMapping,
  splitCSVLine,
  type ColumnMapping,
} from "@/lib/csv-import/parser";

// Admin-assisted event import.
//
// Security posture:
//   * Gated on admin user_id (getAdminUser).
//   * Re-parses the raw CSV text SERVER-SIDE using the shared parser
//     module. The client-side preview exists for UX — but the writes
//     come from this route's own parse, so a tampered admin UI can't
//     bypass validation or inject columns.
//   * Target userId comes from the request body; the admin is
//     explicitly acting on behalf of that user.
//
// Idempotency:
//   * Duplicates (event_name + event_date + user_id) are skipped by
//     default. Admin must explicitly pass dupActions entries with
//     action !== "skip" to override.
//   * Re-uploading the same CSV with default actions = no-op (the
//     audit trail still logs the attempt, which is the right behavior
//     — the act of asking counts even when the result is zero).

interface DupAction {
  event_name: string;
  event_date: string;
  action: "skip" | "replace" | "keep_both";
  existing_event_id?: string;
}

interface ImportBody {
  userId: string;
  csvText: string;
  columnMappings: ColumnMapping[];
  dupActions?: DupAction[];
  /**
   * Batch default state (US 2-letter code or "OTHER"). Applied to
   * rows that don't have a state from the CSV mapping. If the CSV
   * has a state column AND provides a value for a row, the row's
   * value wins — the batch default is strictly a fallback.
   *
   * This is the "approach C" dual behavior per the product plan: map
   * state from the CSV if present, fallback to a one-click batch
   * default for CSVs that don't have a state column (Nick's
   * reactivation import, where 200+ events share a single state).
   */
  defaultState?: string;
}

interface InsertError {
  row: number;
  event_name: string;
  message: string;
}

function parseCsvTextToLines(csvText: string): string[][] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const out: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    out.push(splitCSVLine(lines[i]));
  }
  return out;
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ImportBody;
  try {
    body = (await req.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, csvText, columnMappings } = body;
  const dupActions = body.dupActions ?? [];

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (!csvText || typeof csvText !== "string") {
    return NextResponse.json({ error: "csvText required" }, { status: 400 });
  }
  if (!Array.isArray(columnMappings)) {
    return NextResponse.json({ error: "columnMappings required" }, { status: 400 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify target user exists before we write anything. Service role
  // writes bypass the profiles FK check at the events table (events.user_id
  // references auth.users directly), but we want to fail loudly with a
  // clear message rather than create orphan event rows.
  const { data: targetProfile } = await service
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!targetProfile) {
    return NextResponse.json(
      { error: `No profile found for userId ${userId}` },
      { status: 404 }
    );
  }

  // Re-parse server-side. This is the authoritative parse — the client
  // preview is for UX only.
  const dataLines = parseCsvTextToLines(csvText);
  if (dataLines.length === 0) {
    return NextResponse.json(
      { error: "CSV is empty or has only a header row" },
      { status: 400 }
    );
  }
  const parsed = parseWithMapping(dataLines, columnMappings);
  const validRows = parsed.filter((r) => r.valid);

  // Apply duplicate actions. Admin UI sends one DupAction per
  // (name, date) pair the duplicate check surfaced. Rows not in
  // dupActions are assumed non-duplicates and proceed normally.
  const dupMap = new Map<string, DupAction>();
  for (const d of dupActions) {
    dupMap.set(`${d.event_name}|${d.event_date}`, d);
  }

  let skippedDuplicates = 0;
  const replaceIds: string[] = [];
  const rowsToInsert = validRows.filter((r) => {
    const match = dupMap.get(`${r.event_name}|${r.event_date}`);
    if (!match) return true;
    if (match.action === "skip") {
      skippedDuplicates++;
      return false;
    }
    if (match.action === "replace" && match.existing_event_id) {
      replaceIds.push(match.existing_event_id);
    }
    return true; // replace and keep_both both proceed to insert
  });

  // Delete rows flagged for replacement before inserting new ones.
  // Chunk the .in() to stay well under PostgREST's URL length limit.
  if (replaceIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < replaceIds.length; i += CHUNK) {
      const { error: delError } = await service
        .from("events")
        .delete()
        .eq("user_id", userId)
        .in("id", replaceIds.slice(i, i + CHUNK));
      if (delError) {
        return NextResponse.json(
          { error: `Replace-delete failed: ${delError.message}` },
          { status: 500 }
        );
      }
    }
  }

  // Build insert payloads. Mirror the shape self-serve writes — same
  // defaults, same null-vs-empty conventions, same cost-field guard.
  // state resolution: row's own state (from CSV column mapping) wins;
  // batch default applied when the row didn't bring one. Both can be
  // null if neither present — matches "leave NULL for historical"
  // policy for rows missing location context.
  const batchDefaultState = body.defaultState ?? null;
  const insertData = rowsToInsert.map((r) => ({
    user_id: userId,
    event_name: r.event_name,
    event_date: r.event_date,
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    setup_time: r.setup_time ?? null,
    city: r.city ?? null,
    state: r.state ?? batchDefaultState,
    net_sales: r.net_sales ?? null,
    event_type: r.event_type ?? null,
    location: r.location ?? null,
    fee_type: matchFeeType(r.fee_type ?? ""),
    fee_rate: r.fee_rate ?? 0,
    sales_minimum: r.sales_minimum ?? 0,
    forecast_sales: r.forecast_sales ?? null,
    notes: r.notes ?? null,
    booked: r.booked !== undefined ? r.booked : true,
    event_tier: r.event_tier ?? null,
    anomaly_flag: r.anomaly_flag ?? "normal",
    event_weather: r.weather_type ?? null,
    expected_attendance: r.expected_attendance ?? null,
    event_mode: (r.event_mode === "catering" ? "catering" : "food_truck") as
      | "food_truck"
      | "catering",
    pos_source: "manual" as const,
    // Cost fields skipped when undefined so environments without the
    // cost-columns migration don't 400. Matches self-serve behavior.
    ...(r.food_cost !== undefined ? { food_cost: r.food_cost } : {}),
    ...(r.labor_cost !== undefined ? { labor_cost: r.labor_cost } : {}),
    ...(r.other_costs !== undefined ? { other_costs: r.other_costs } : {}),
  }));

  const BATCH_SIZE = 50;
  let inserted = 0;
  const errors: InsertError[] = [];

  for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
    const batch = insertData.slice(i, i + BATCH_SIZE);
    const { error: batchError } = await service.from("events").insert(batch);
    if (batchError) {
      // Batch failed — retry row-by-row to isolate the bad one(s).
      // Matches self-serve import's defensive retry.
      for (let j = 0; j < batch.length; j++) {
        const { error: rowError } = await service
          .from("events")
          .insert(batch[j]);
        if (rowError) {
          errors.push({
            row: i + j + 1,
            event_name: batch[j].event_name,
            message: rowError.message,
          });
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
  }

  // Recalculate forecasts and performance for the target user so they
  // reflect the newly-imported events. Uses the service-role variant
  // directly (same function the cron auto-sync uses), so the recalc
  // runs against the target user's data without needing their cookies.
  // Non-critical: import is considered successful even if recalc fails.
  if (inserted > 0) {
    try {
      await recalculateForUserWithClient(userId, service);
    } catch (err) {
      console.error("admin_import_recalc_failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.import_events",
      targetType: "user",
      targetId: userId,
      metadata: {
        inserted,
        skipped_duplicates: skippedDuplicates,
        replaced: replaceIds.length,
        errors_count: errors.length,
        invalid_rows: parsed.length - validRows.length,
        total_rows: parsed.length,
      },
    },
    service
  );

  return NextResponse.json({
    inserted,
    skipped_duplicates: skippedDuplicates,
    replaced: replaceIds.length,
    invalid_rows: parsed.length - validRows.length,
    total_rows: parsed.length,
    errors,
  });
}
