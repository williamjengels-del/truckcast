import { NextRequest, NextResponse, after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import { recalculateForUserWithClient } from "@/lib/recalculate-service";

// PATCH /api/admin/events/[eventId]/anomaly
// Body: { anomaly_flag: "normal" | "disrupted" | "boosted" }
//
// Single-field toggle for the anomaly_flag. Separate from the main
// event edit route because:
//   - distinct audit action (user.event_anomaly_flag vs user.event_edit)
//   - no weather re-classify, no field diffing, no modal
//   - one-click interaction pattern ("Flag" button on the events row)
//
// anomaly_flag semantics (from src/lib/constants.ts):
//   normal    — included in stats + forecast calibration
//   disrupted — excluded from stats (weather disaster, organizer chaos)
//   boosted   — flagged as abnormally high, excluded from calibration
//
// Disrupted is the common admin intervention; boosted exists but is
// rarely set and goes through the full Edit modal for deliberation.

const VALID_FLAGS = ["normal", "disrupted", "boosted"] as const;
type AnomalyFlag = (typeof VALID_FLAGS)[number];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { eventId } = await params;
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  let body: { anomaly_flag?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const newFlag = body.anomaly_flag;
  if (!newFlag || !VALID_FLAGS.includes(newFlag as AnomalyFlag)) {
    return NextResponse.json(
      {
        error: `anomaly_flag must be one of ${VALID_FLAGS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Lookup for user_id + current flag (audit needs before/after).
  const { data: current, error: fetchError } = await service
    .from("events")
    .select("id, user_id, event_name, event_date, anomaly_flag")
    .eq("id", eventId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const typedCurrent = current as {
    id: string;
    user_id: string;
    event_name: string;
    event_date: string;
    anomaly_flag: string | null;
  };
  const previousFlag = typedCurrent.anomaly_flag ?? "normal";

  if (previousFlag === newFlag) {
    return NextResponse.json({
      success: true,
      event_id: eventId,
      anomaly_flag: newFlag,
      changed: false,
      message: "Already set to this value.",
    });
  }

  const { error: updateError } = await service
    .from("events")
    .update({ anomaly_flag: newFlag })
    .eq("id", eventId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.event_anomaly_flag",
      targetType: "user",
      targetId: typedCurrent.user_id,
      metadata: {
        event_id: eventId,
        event_name: typedCurrent.event_name,
        event_date: typedCurrent.event_date,
        from: previousFlag,
        to: newFlag,
      },
    },
    service
  );

  // Recalc — disrupted/boosted flag changes alter which events count
  // toward performance aggregates and forecast coefficients. Deferred
  // via after() so the toggle returns immediately; see the edit route
  // for the full rationale.
  after(async () => {
    try {
      await recalculateForUserWithClient(typedCurrent.user_id, service);
    } catch (err) {
      console.error("admin_event_anomaly_recalc_failed", {
        eventId,
        userId: typedCurrent.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return NextResponse.json({
    success: true,
    event_id: eventId,
    anomaly_flag: newFlag,
    previous: previousFlag,
    changed: true,
    recalc: "queued",
  });
}
