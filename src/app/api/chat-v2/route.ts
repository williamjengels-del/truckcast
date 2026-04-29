import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { runAgentLoop } from "@/lib/chat-tools/agent-loop";

// Tier-B chat endpoint — tool-calling chatbot for Premium operators.
//
// Tier-A (/api/chat) front-loads last-100-events into the system prompt
// and uses a smaller model. Tier-B keeps a tight system prompt and lets
// the model fetch what it needs via tools defined in
// src/lib/chat-tools/. See vendcast_planning_tier-b-chatbot_2026-04-29.md
// for the full design rationale.
//
// Locked decisions (durable in memory):
//   - Premium-only tier gating (cost delta to Tier-A is real;
//     Premium under-differentiated against Pro)
//   - Read-only tool surface in v1 (revisit after 30 days)
//   - No persisted chat history in v1 (privacy surface)
//   - $10/operator/month soft cap (telemetry + cap enforcement
//     ships as PR 4)
//
// This PR (PR 2 of the Tier-B workstream) is the endpoint + agent
// loop. PR 3 is the chat widget extension; PR 4 is cost telemetry +
// cap; PR 5 is the production rollout flip.

// Tighter rate limit than Tier-A — each turn can fan out to up to 6
// tool calls, so a Tier-B "message" is multiple Anthropic requests
// internally. 10/hr keeps the per-operator hourly cost in line with
// Tier-A's 20/hr at ~5x the cost-per-message.
const CHAT_V2_RATE_LIMIT = 10;
const CHAT_V2_RATE_WINDOW_MS = 60 * 60 * 1000;

const TIER_B_MODEL = "claude-sonnet-4-6";
const TIER_B_MAX_TOKENS = 2048;

interface ChatV2RequestBody {
  /**
   * Full conversation history. Client maintains the message log
   * in-memory (no persistence in v1).
   *   role: "user" | "assistant"
   *   content: string
   * Tool blocks are managed server-side inside the agent loop and
   * never round-trip through the client.
   */
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "AI assistant is temporarily unavailable" },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Premium-only tier gate (Tier-B locked decision). Pro+Premium
    // continues to use Tier-A at /api/chat.
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, business_name, city, state")
      .eq("id", user.id)
      .single<{
        subscription_tier: "starter" | "pro" | "premium";
        business_name: string | null;
        city: string | null;
        state: string | null;
      }>();

    const tier = profile?.subscription_tier ?? "starter";
    if (tier !== "premium") {
      return Response.json(
        { error: "Premium subscription required for the advanced AI assistant" },
        { status: 403 }
      );
    }

    const rateKey = `chat-v2:${user.id}`;
    if (!checkRateLimit(rateKey, CHAT_V2_RATE_LIMIT, CHAT_V2_RATE_WINDOW_MS)) {
      return Response.json(
        {
          error: `Rate limit reached (${CHAT_V2_RATE_LIMIT} messages per hour). Please slow down.`,
        },
        { status: 429 }
      );
    }

    const body = (await req.json()) as ChatV2RequestBody;
    const messages = body.messages ?? [];
    if (messages.length === 0) {
      return Response.json({ error: "messages is required" }, { status: 400 });
    }
    if (messages.length > 20) {
      // Conservative cap to avoid runaway prompt growth on long
      // sessions. Client should trim its history.
      return Response.json(
        { error: "Conversation too long — trim and try again" },
        { status: 400 }
      );
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || !last.content?.trim()) {
      return Response.json(
        { error: "Last message must be from the user with non-empty content" },
        { status: 400 }
      );
    }

    const businessName = profile?.business_name ?? "this vendor";
    const location = [profile?.city, profile?.state].filter(Boolean).join(", ");
    const today = new Date().toISOString().split("T")[0];

    // Tier-B system prompt is intentionally short. The model should
    // reach for tools to get specific data rather than relying on
    // pre-loaded snapshots. Operator voice — direct, no hedging.
    const systemPrompt = `You are a data analyst assistant for ${businessName}${
      location ? ` (${location})` : ""
    }, a mobile vendor using VendCast. You have read-only tools to query their event history, performance aggregates, and upcoming calendar.

Today's date: ${today}.

When answering:
- Use tools to get specific data instead of guessing. Multiple tool calls are fine when needed.
- Reference event names, dates, and dollar amounts directly from the tool results.
- Keep responses tight — operators move fast. Under 250 words unless a question needs detail.
- If a forecasted event is "pre-settled" or "commission_with_minimum" the headline number is the contracted payout, not the model's prediction. Don't lead with a forecast range that contradicts the contract.
- No markdown formatting in responses. Plain text.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const result = await runAgentLoop({
      client,
      model: TIER_B_MODEL,
      systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ctx: { userId: user.id, supabase },
      maxTokens: TIER_B_MAX_TOKENS,
    });

    // Cost telemetry: console.log for now so it surfaces in Vercel
    // logs. PR 4 (cost telemetry table) replaces this with a chat_v2_usage
    // row insert + the monthly cap check.
    console.log("[chat-v2] usage", {
      user_id: user.id,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      tool_calls: result.toolCalls.length,
      truncated: result.truncated,
      stop_reason: result.stopReason,
    });

    return Response.json({
      text: result.text,
      tool_calls: result.toolCalls.map((tc) => ({
        name: tc.name,
        input: tc.input,
        // Don't ship full results to the client — too large. Just a
        // shape summary so the widget can show "I queried X."
        result_summary: tc.error
          ? { error: tc.error }
          : summarizeToolResult(tc.result),
      })),
      truncated: result.truncated,
      usage: result.usage,
    });
  } catch (err) {
    console.error("[chat-v2] error:", err);
    Sentry.captureException(err, { tags: { source: "chat_v2_api" } });
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Compact representation of a tool result for client-side display.
 * The full result already informed the model's response — the client
 * just needs to know how big the queried slice was.
 */
function summarizeToolResult(result: unknown): { count?: number; sample?: string } {
  if (result && typeof result === "object" && "count" in result) {
    return { count: (result as { count: number }).count };
  }
  if (Array.isArray(result)) {
    return { count: result.length };
  }
  return { sample: typeof result };
}
