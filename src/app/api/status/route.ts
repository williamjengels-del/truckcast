import { NextResponse } from "next/server";
import { computeStatus } from "@/lib/status";

/**
 * GET /api/status
 *
 * Live health probe for the public /status page. Cached at the Vercel
 * edge for 60s so a flood of /status loads doesn't actually flood the
 * underlying services.
 *
 * Implementation moved to `src/lib/status.ts` so the page can call the
 * computation directly (avoiding an HTTP roundtrip that broke when the
 * SSR fetch built a URL from VERCEL_URL behind deployment-protection).
 * This route now just exposes the computed payload as JSON for any
 * caller that wants the API surface (uptime monitors, webhooks, etc.).
 */

export const revalidate = 60;

export async function GET() {
  const payload = await computeStatus();
  return NextResponse.json(payload);
}
