import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/admin-audit";
import { canonicalizeCity } from "@/lib/city-normalize";
import { US_STATES } from "@/lib/constants";

/**
 * PATCH /api/admin/users/[userId]/location
 *
 * Body: { city: string, state: string }
 *
 * Admin-only path to fix an operator's city/state on their profile.
 * The motivating case: operators who finish signup but never complete
 * onboarding leave city NULL, and the marketplace routing query
 * (`canonicalizeCity` on profile.city) skips them entirely. Surfaced
 * during 2026-05-03 testing — Nick Baur was signed up but invisible
 * to /request-event matching because his city wasn't set.
 *
 * Behavior:
 *   - Empty city/state allowed — clears the fields. (Use sparingly;
 *     clearing makes the operator un-routable on the marketplace
 *     until they complete onboarding.)
 *   - City is run through `canonicalizeCity()` before save so spelling
 *     variants ("St. Louis" / "Saint Louis" / "St.Louis") all land as
 *     the canonical form for marketplace routing.
 *   - State must be a known US 2-letter code. Empty strings allowed.
 *
 * Audit-logged as `user.location_edit` with metadata
 * { city_from, city_to, state_from, state_to, email }.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const r = body as Record<string, unknown>;

  const rawCity = typeof r.city === "string" ? r.city : "";
  const rawState = typeof r.state === "string" ? r.state.trim().toUpperCase() : "";

  if (rawState && !US_STATES.includes(rawState)) {
    return NextResponse.json(
      { error: `Unknown state code: ${rawState}` },
      { status: 400 }
    );
  }

  const cityCanonical = canonicalizeCity(rawCity);

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Capture the prior values for the audit row before mutating.
  const { data: prior, error: priorError } = await service
    .from("profiles")
    .select("city, state")
    .eq("id", userId)
    .maybeSingle();
  if (priorError || !prior) {
    return NextResponse.json(
      { error: priorError?.message ?? "User not found" },
      { status: 404 }
    );
  }
  const cityFrom = (prior as { city: string | null }).city ?? null;
  const stateFrom = (prior as { state: string | null }).state ?? null;

  // Look up email for the audit row.
  const { data: target } = await service.auth.admin.getUserById(userId);
  const email = target?.user?.email ?? null;

  const { error: updateError } = await service
    .from("profiles")
    .update({
      city: cityCanonical || null,
      state: rawState || null,
    })
    .eq("id", userId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logAdminAction(
    {
      adminUserId: admin.id,
      action: "user.location_edit",
      targetType: "user",
      targetId: userId,
      metadata: {
        email,
        city_from: cityFrom,
        city_to: cityCanonical || null,
        state_from: stateFrom,
        state_to: rawState || null,
      },
    },
    service
  );

  return NextResponse.json({
    ok: true,
    city: cityCanonical || null,
    state: rawState || null,
  });
}
