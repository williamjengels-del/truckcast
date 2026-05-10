/**
 * VendCast subsystem status — shared computation called by both
 * /api/status and the /status page directly.
 *
 * Why a shared helper:
 * Pre-2026-05-10 the /status page did a server-side `fetch()` against
 * its own `/api/status` endpoint, building the URL from `VERCEL_URL`.
 * That URL is per-deployment (e.g. `vendcast-abc123.vercel.app`), often
 * behind Vercel's deployment-protection 401, and not the canonical
 * `vendcast.co` route. The fetch failed silently (caught + null
 * returned), and the page rendered "Status unavailable" while
 * /api/status itself worked fine. Public-facing embarrassment.
 *
 * Fix: don't roundtrip through HTTP. The page calls `computeStatus()`
 * directly. The API route also calls `computeStatus()`. Same data,
 * one source of truth, no URL construction.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";

export interface SubsystemStatus {
  name: string;
  status: "operational" | "degraded" | "down" | "unknown";
  detail?: string;
}

export interface StatusPayload {
  overall: SubsystemStatus["status"];
  checked_at: string;
  subsystems: SubsystemStatus[];
}

async function checkDatabase(): Promise<SubsystemStatus> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { name: "Database", status: "down", detail: "Service role env vars missing" };
  }
  try {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { error } = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error) {
      return { name: "Database", status: "degraded", detail: error.message };
    }
    return { name: "Database", status: "operational" };
  } catch (e) {
    return {
      name: "Database",
      status: "down",
      detail: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

function checkStripe(): SubsystemStatus {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { name: "Billing (Stripe)", status: "down", detail: "STRIPE_SECRET_KEY missing" };
  }
  return { name: "Billing (Stripe)", status: "operational" };
}

async function checkWeather(): Promise<SubsystemStatus> {
  try {
    // Tiny ping against Open-Meteo's geocoding endpoint. Free, no API
    // key, generous rate limit. Returns 200 + JSON when up.
    const res = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search?name=St.+Louis&count=1",
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) {
      return { name: "Weather (Open-Meteo)", status: "degraded", detail: `HTTP ${res.status}` };
    }
    return { name: "Weather (Open-Meteo)", status: "operational" };
  } catch (e) {
    return {
      name: "Weather (Open-Meteo)",
      status: "down",
      detail: e instanceof Error ? e.message : "Network error",
    };
  }
}

function checkEmail(): SubsystemStatus {
  if (!process.env.RESEND_API_KEY) {
    return {
      name: "Email (Resend)",
      status: "degraded",
      detail: "RESEND_API_KEY missing — outbound email disabled",
    };
  }
  return { name: "Email (Resend)", status: "operational" };
}

function checkChatbot(): SubsystemStatus {
  if (process.env.CHAT_V2_DISABLED === "1") {
    return {
      name: "Chatbot (Tier-B)",
      status: "degraded",
      detail: "Disabled via CHAT_V2_DISABLED kill switch",
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "Chatbot (Tier-B)",
      status: "down",
      detail: "ANTHROPIC_API_KEY missing",
    };
  }
  return { name: "Chatbot (Tier-B)", status: "operational" };
}

export async function computeStatus(): Promise<StatusPayload> {
  const subsystems: SubsystemStatus[] = await Promise.all([
    Promise.resolve({ name: "Dashboard", status: "operational" as const }),
    checkDatabase(),
    Promise.resolve(checkStripe()),
    checkWeather(),
    Promise.resolve(checkEmail()),
    Promise.resolve(checkChatbot()),
  ]);

  const overall: SubsystemStatus["status"] = subsystems.some((s) => s.status === "down")
    ? "down"
    : subsystems.some((s) => s.status === "degraded")
      ? "degraded"
      : "operational";

  return {
    overall,
    checked_at: new Date().toISOString(),
    subsystems,
  };
}
