import { NextRequest, NextResponse, after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import { recalculateForUserWithClient } from "@/lib/recalculate-service";
import { autoClassifyWeather } from "@/lib/weather";
import { canonicalizeCity } from "@/lib/city-normalize";
import type { EventFormData } from "@/app/dashboard/events/actions";

// PATCH /api/admin/events/[eventId]
// Body: { formData: Partial<EventFormData> }
//
// Admin-side edit of ANY user's event. Writes via service-role client
// so RLS doesn't block the update (the admin isn't the event owner).
// Mirrors the user-facing updateEvent() server action's behavior but:
//   - no auth.uid() scoping (admin can edit any event)
//   - target user's id pulled from the event row itself, not the request
//   - recalculate runs against the event's user, not the admin
//   - audit log written with the event's owner as target_id so the
//     activity feed shows "admin edited event X on user Y's account"
//
// Preserves the auto-weather-classification side effect from the user
// path — if city or event_date change and no explicit weather is
// provided, weather is re-derived. Admin editing a user's event
// should behave like the user editing it themselves (minus the
// scoping differences above).

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

  let body: { formData?: Partial<EventFormData> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const formData = body.formData;
  if (!formData || typeof formData !== "object") {
    return NextResponse.json({ error: "formData required" }, { status: 400 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch current event — authoritative source for user_id, current
  // values (for diff), and city/date for weather fallback.
  const { data: current, error: fetchError } = await service
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const targetUserId = (current as { user_id: string }).user_id;

  // Build updateData and capture which fields actually changed.
  // Empty strings coerce to null to match the user-side convention.
  const updateData: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const [key, value] of Object.entries(formData)) {
    if (value === undefined) continue;
    let normalized: unknown = value === "" ? null : value;
    // Canonicalize city at write time — same treatment as the
    // user-facing action. "St. Louis" and "Saint Louis" must land on
    // the same stored form so aggregation/comparison agrees downstream.
    if (key === "city" && typeof normalized === "string") {
      const canonical = canonicalizeCity(normalized);
      normalized = canonical || null;
    }
    if ((current as Record<string, unknown>)[key] !== normalized) {
      updateData[key] = normalized;
      changedFields.push(key);
    }
  }

  // Weather auto-classify: same trigger as the user action — if city,
  // state, or date changed and weather wasn't explicitly set, try to
  // re-derive. State is read from the update payload if present,
  // otherwise from the current row.
  const cityChanged = "city" in updateData;
  const stateChanged = "state" in updateData;
  const dateChanged = "event_date" in updateData;
  const weatherExplicit = "event_weather" in updateData;
  if ((cityChanged || stateChanged || dateChanged) && !weatherExplicit) {
    const resolvedCity =
      (updateData.city as string | null | undefined) ??
      (current as { city: string | null }).city;
    const resolvedDate =
      (formData.event_date as string | undefined) ??
      (current as { event_date: string }).event_date;
    const resolvedState =
      (formData.state as string | undefined) ??
      (current as { state: string | null }).state ??
      null;
    if (resolvedCity && resolvedDate) {
      try {
        const wx = await autoClassifyWeather(
          resolvedCity,
          resolvedDate,
          service,
          resolvedState
        );
        if (wx) {
          updateData.event_weather = wx.classification;
          if (!formData.latitude && !(current as { latitude: number | null }).latitude) {
            updateData.latitude = wx.latitude;
          }
          if (!formData.longitude && !(current as { longitude: number | null }).longitude) {
            updateData.longitude = wx.longitude;
          }
          if (!changedFields.includes("event_weather")) {
            changedFields.push("event_weather");
          }
        }
      } catch {
        // Non-fatal — weather lookup is best-effort, don't block the edit.
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({
      success: true,
      event: current,
      changed_fields: [],
      message: "No changes detected.",
    });
  }

  const { data: updated, error: updateError } = await service
    .from("events")
    .update(updateData)
    .eq("id", eventId)
    .select()
    .single();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Audit before kicking off recalculate — if recalc fails the edit
  // still stands and must be auditable.
  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.event_edit",
      targetType: "user",
      targetId: targetUserId,
      metadata: {
        event_id: eventId,
        event_name: (updated as { event_name: string }).event_name,
        event_date: (updated as { event_date: string }).event_date,
        changed_fields: changedFields,
      },
    },
    service
  );

  // Recalculate for the target user — forecast coefficients and
  // performance aggregates depend on event data changing.
  //
  // Wrapped in after() so it runs after the response is sent. On an
  // account with years of event history (e.g. Wok-O's hundreds of
  // events across many unique event names) recalc takes 10+ seconds —
  // synchronous would block the save UI on every edit. Same pattern
  // used by the push notification trigger. If recalc fails in the
  // background, console.error lands in Vercel logs; the edit itself
  // has already been persisted and audited.
  after(async () => {
    try {
      await recalculateForUserWithClient(targetUserId, service);
    } catch (err) {
      console.error("admin_event_edit_recalc_failed", {
        eventId,
        targetUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return NextResponse.json({
    success: true,
    event: updated,
    changed_fields: changedFields,
    recalc: "queued",
  });
}
