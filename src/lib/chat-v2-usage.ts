// Tier-B chat usage tracking + monthly cost cap.
//
// Records per-turn token usage to chat_v2_usage and enforces a
// per-operator monthly cost cap. Wired into /api/chat-v2 once the
// endpoint (PR 2 / #58) merges; this module is shippable independently
// because it's a pure utility surface.
//
// Locked decisions (memory: project_vendcast_tier-b_chatbot.md):
//   - $10/operator/month soft cap (CHAT_V2_DEFAULT_CAP_CENTS)
//   - Configurable via env var CHAT_V2_MONTHLY_CAP_CENTS
//   - Per-operator override deferred to a follow-up admin tool

import type { SupabaseClient } from "@supabase/supabase-js";

// Pricing constants for claude-sonnet-4-6 (per 1M tokens, in cents).
// Update here when Anthropic publishes new pricing — keeping it in
// one place + versioned in commit history is the audit trail.
export const SONNET_INPUT_CENTS_PER_MTOK = 300; // $3.00 / MTok input
export const SONNET_OUTPUT_CENTS_PER_MTOK = 1500; // $15.00 / MTok output

export const CHAT_V2_DEFAULT_CAP_CENTS = 1000; // $10.00 / operator / month

export function chatV2MonthlyCapCents(): number {
  const env = process.env.CHAT_V2_MONTHLY_CAP_CENTS;
  if (!env) return CHAT_V2_DEFAULT_CAP_CENTS;
  const parsed = Number.parseInt(env, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return CHAT_V2_DEFAULT_CAP_CENTS;
  }
  return parsed;
}

/**
 * Compute cost in cents for a (input_tokens, output_tokens) pair.
 * Uses ceiling on the cents conversion so we don't under-charge by
 * fractional cents that would compound over many requests.
 */
export function computeCostCents(args: {
  input_tokens: number;
  output_tokens: number;
}): number {
  const inputCost =
    (args.input_tokens * SONNET_INPUT_CENTS_PER_MTOK) / 1_000_000;
  const outputCost =
    (args.output_tokens * SONNET_OUTPUT_CENTS_PER_MTOK) / 1_000_000;
  return Math.ceil(inputCost + outputCost);
}

/**
 * Sum of cost_cents for the current calendar month for this user.
 * Calendar month boundary is UTC — aligned with how Anthropic reports
 * usage in the dashboard.
 */
export async function monthToDateCostCents(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data, error } = await supabase
    .from("chat_v2_usage")
    .select("cost_cents")
    .eq("user_id", userId)
    .gte("created_at", monthStart);

  if (error) {
    // Failing the cap query open is preferable to failing closed —
    // chat is non-critical, and a query glitch shouldn't lock an
    // operator out. Surface to logs so it's visible.
    console.error("[chat-v2-usage] monthToDateCostCents query failed", error);
    return 0;
  }
  return (data ?? []).reduce(
    (sum, row) => sum + ((row as { cost_cents: number }).cost_cents ?? 0),
    0
  );
}

/**
 * Cap-check shape used at the start of /api/chat-v2 — refuse the
 * request if month-to-date already exceeds the cap. Returns
 * { ok: false, reason } when over; { ok: true } otherwise.
 */
export type CapCheckResult =
  | { ok: true; spentCents: number; capCents: number }
  | { ok: false; spentCents: number; capCents: number; reason: string };

export async function checkMonthlyCap(
  supabase: SupabaseClient,
  userId: string
): Promise<CapCheckResult> {
  const cap = chatV2MonthlyCapCents();
  const spent = await monthToDateCostCents(supabase, userId);
  if (spent >= cap) {
    return {
      ok: false,
      spentCents: spent,
      capCents: cap,
      reason: `AI assistant monthly cap reached for this operator ($${(cap / 100).toFixed(2)}). Resets on the 1st.`,
    };
  }
  return { ok: true, spentCents: spent, capCents: cap };
}

/**
 * Insert one row capturing this turn's usage. Service-role client
 * required (RLS doesn't grant INSERT to authenticated; only the
 * server side writes here). Caller passes the service client.
 *
 * Failures are logged + swallowed — telemetry must never block the
 * operator's response from returning. Same precedent as
 * src/lib/admin-audit.ts:logAdminAction.
 */
export async function recordChatV2Usage(
  service: SupabaseClient,
  args: {
    userId: string;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    stopReason: string;
    truncated: boolean;
  }
): Promise<void> {
  const cost = computeCostCents({
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
  });
  const { error } = await service.from("chat_v2_usage").insert({
    user_id: args.userId,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    cost_cents: cost,
    tool_calls: args.toolCalls,
    stop_reason: args.stopReason,
    truncated: args.truncated,
  });
  if (error) {
    console.error("[chat-v2-usage] recordChatV2Usage failed", {
      user_id: args.userId,
      error: error.message,
    });
  }
}
