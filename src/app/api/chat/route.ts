import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

// Per-user rate limit. Anthropic Claude Haiku pricing + our ~2kB system
// prompt (event data) means a 100-msg/hr burst per user could materially
// surprise a cost review. Starter-tier is already blocked below, so this
// caps the Pro/Premium case at a rhythm that's generous for real
// operator use (one question every few minutes) but refuses bot-grade
// hammer patterns. Window + limit are intentionally tight — if we see
// real users bumping against it, raise, don't replace.
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    // TODO: Re-enable when ANTHROPIC_API_KEY is added to Vercel; gated behind
    // Pro/Premium tier. The ChatWidget also refuses to render when the env
    // var is absent, so in practice this guard is belt-and-suspenders.
    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI assistant is temporarily unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check subscription tier — Pro/Premium only
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, business_name")
      .eq("id", user.id)
      .single();

    const tier = profile?.subscription_tier ?? "starter";
    if (tier === "starter") {
      return new Response(
        JSON.stringify({ error: "Pro or Premium subscription required" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Per-user rate limit AFTER auth + tier gate so anonymous /
    // starter-tier probes don't get to spend our limiter budget. Best-
    // effort only — see src/lib/rate-limit.ts for the in-memory-vs-
    // serverless caveat. Upgrade to Supabase-backed if we see real
    // abuse.
    const rateKey = `chat:${user.id}`;
    if (!checkRateLimit(rateKey, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS)) {
      return new Response(
        JSON.stringify({
          error: `Rate limit reached (${CHAT_RATE_LIMIT} messages per hour). Please slow down.`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await req.json() as { message?: string };
    const message = body.message?.trim();
    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch user's last 100 events
    const { data: events } = await supabase
      .from("events")
      .select(
        "event_name, event_date, event_type, net_sales, forecast_sales, city, event_weather, fee_type, event_mode, event_tier, booked, anomaly_flag"
      )
      .eq("user_id", user.id)
      .order("event_date", { ascending: false })
      .limit(100);

    // Fetch top 10 event performance records
    const { data: performance } = await supabase
      .from("event_performance")
      .select("event_name, avg_sales, times_booked, trend, confidence")
      .eq("user_id", user.id)
      .order("avg_sales", { ascending: false })
      .limit(10);

    const today = new Date().toISOString().split("T")[0];
    const businessName = profile?.business_name ?? "this vendor";

    const systemPrompt = `You are a data analyst assistant for ${businessName}, a mobile vendor using VendCast. You have access to their event history and performance data. Answer questions about their business concisely and helpfully. Always ground your answers in their actual data. Be direct — this operator moves fast.

Here is their event data (last 100 events):
${JSON.stringify(events ?? [], null, 2)}

Here is their top event performance summary:
${JSON.stringify(performance ?? [], null, 2)}

Today's date: ${today}

When answering:
- Reference specific event names, dates, and dollar amounts from the data
- If calculating averages or totals, show your work briefly
- For forecasting questions, note that forecasts in the data are already model-generated
- Keep responses under 300 words unless the question demands detail
- Use plain text, no markdown formatting`;

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Return a streaming response
    const stream = await client.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[chat] error:", err);
    // Ship to Sentry so Anthropic API failures (rate limit, auth, 5xx)
    // surface in the same observability channel as other webhook
    // errors. Avoid serializing the full conversation to keep Sentry
    // payloads small and PII-light.
    Sentry.captureException(err, {
      tags: { source: "chat_api" },
    });
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
