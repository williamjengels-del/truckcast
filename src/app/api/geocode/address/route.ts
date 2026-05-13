import { NextRequest, NextResponse } from "next/server";
import { resolveScopedSupabase } from "@/lib/dashboard-scope";
import { geocodeAddress, isGeocodingEnabled } from "@/lib/mapbox-geocoder";

/**
 * POST /api/geocode/address
 *
 * Server-side proxy for the client-side resolved-address preview shown
 * under the event-form Address field. The Mapbox token lives in
 * MAPBOX_API_TOKEN (no NEXT_PUBLIC_ prefix) so it never reaches the
 * client bundle — the preview hits this route, this route hits Mapbox.
 *
 * Auth: requires an authenticated session via resolveScopedSupabase.
 * Anonymous users get 401. Managers + impersonating admins can hit
 * this route same as owners — the geocode is read-only and doesn't
 * write anything.
 *
 * Body: { address: string, city?: string, state?: string }
 *
 * Response (200): { ok: true, resolved_address, latitude, longitude, cell_id }
 * Response (200, geocoder disabled): { ok: false, reason: "disabled" }
 * Response (200, no match): { ok: false, reason: "not_found" }
 * Response (400): { error: "..." }
 * Response (401): { error: "Unauthorized" }
 *
 * Residual abuse vector: a logged-in operator could chew through the
 * Mapbox quota by spamming this endpoint. Flagged in PR body + brief.
 * Not blocked today (trusted operator set, free tier auto-caps at
 * 100K/month with HTTP 429s past that — no billing). Mitigation when
 * we cross ~20 sharing operators or see quota climb: per-user rate
 * limit (e.g. 100 geocodes/user/day) backed by a small usage table.
 */

export async function POST(req: NextRequest) {
  const scope = await resolveScopedSupabase();
  if (scope.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGeocodingEnabled()) {
    return NextResponse.json({ ok: false, reason: "disabled" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const r = body as Record<string, unknown>;
  const address = typeof r.address === "string" ? r.address : null;
  const city = typeof r.city === "string" ? r.city : null;
  const state = typeof r.state === "string" ? r.state : null;

  if (!address || !address.trim()) {
    return NextResponse.json(
      { error: "address required" },
      { status: 400 }
    );
  }

  const result = await geocodeAddress(address, city, state);
  if (!result) {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }

  return NextResponse.json({
    ok: true,
    resolved_address: result.resolved_address,
    latitude: result.latitude,
    longitude: result.longitude,
    cell_id: result.cell_id,
  });
}
