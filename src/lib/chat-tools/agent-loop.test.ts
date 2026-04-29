import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentLoop } from "./agent-loop";
import { MAX_TOOL_CALLS_PER_TURN } from "./types";

// Tests for the Tier-B agent loop. The Anthropic client is mocked so
// we can drive specific stop_reason / tool_use sequences without
// hitting the live API. The Supabase client is mocked at the tool
// boundary — get_calendar's handler is the simplest to inject because
// it only needs `from(...).select(...).eq(...)...` to resolve to a
// thenable that returns { data, error }.

interface MockMessage {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

function makeMockClient(responses: MockMessage[]): Anthropic {
  let i = 0;
  const create = vi.fn(async () => {
    if (i >= responses.length) {
      throw new Error("Mock client out of scripted responses");
    }
    return responses[i++] as unknown as Anthropic.Message;
  });
  return {
    messages: { create },
  } as unknown as Anthropic;
}

function makeMockSupabase(rowsByTable: Record<string, unknown[]> = {}) {
  // Minimal Supabase shape — get_calendar needs from(...).select(...).
  // eq(...).is(...).gte(...).lte(...).order(...) to be thenable.
  const builder = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const result = { data: rows, error: null };
    const then = (resolve: (v: typeof result) => void) => {
      resolve(result);
      return Promise.resolve(result);
    };
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.neq = () => chain;
    chain.gte = () => chain;
    chain.lte = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.then = then;
    return chain;
  };
  return {
    from: (table: string) => builder(rowsByTable[table] ?? []),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

describe("runAgentLoop", () => {
  it("returns final text directly when the model needs no tools", async () => {
    const client = makeMockClient([
      {
        content: [{ type: "text", text: "Hello operator." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);

    const result = await runAgentLoop({
      client,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "hi" }],
      ctx: { userId: TEST_USER_ID, supabase: makeMockSupabase() },
    });

    expect(result.text).toBe("Hello operator.");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.input_tokens).toBe(10);
    expect(result.truncated).toBe(false);
  });

  it("dispatches a tool_use, then returns the model's follow-up text", async () => {
    const client = makeMockClient([
      // Round 1: model asks for get_calendar
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "get_calendar",
            input: { weeks_ahead: 2 },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 8 },
      },
      // Round 2: model summarizes the result
      {
        content: [{ type: "text", text: "You have 1 event next week." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 30, output_tokens: 10 },
      },
    ]);

    const result = await runAgentLoop({
      client,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "what's coming up?" }],
      ctx: {
        userId: TEST_USER_ID,
        supabase: makeMockSupabase({
          events: [
            {
              event_name: "Soulard Saturday",
              event_date: "2026-05-04",
              start_time: "10:00",
              end_time: "14:00",
              location: "Soulard Market",
              city: "St. Louis",
              event_type: "Festival",
              event_mode: "food_truck",
            },
          ],
        }),
      },
    });

    expect(result.text).toBe("You have 1 event next week.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("get_calendar");
    expect(result.toolCalls[0].error).toBeUndefined();
    expect(result.usage.input_tokens).toBe(50); // 20 + 30
    expect(result.usage.output_tokens).toBe(18); // 8 + 10
    expect(result.truncated).toBe(false);
  });

  it("captures invalid tool input as a tool_call error and continues", async () => {
    const client = makeMockClient([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "get_calendar",
            input: { weeks_ahead: 999 }, // out of range
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 8 },
      },
      {
        content: [{ type: "text", text: "Sorry, my filter was off." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 25, output_tokens: 6 },
      },
    ]);

    const result = await runAgentLoop({
      client,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "what's up?" }],
      ctx: { userId: TEST_USER_ID, supabase: makeMockSupabase() },
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toContain("weeks_ahead");
    expect(result.text).toBe("Sorry, my filter was off.");
  });

  it("captures unknown tool name as a tool_call error", async () => {
    const client = makeMockClient([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "imaginary_tool",
            input: {},
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 5 },
      },
      {
        content: [{ type: "text", text: "I'll work without that." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    ]);

    const result = await runAgentLoop({
      client,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "hi" }],
      ctx: { userId: TEST_USER_ID, supabase: makeMockSupabase() },
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toMatch(/Unknown tool: imaginary_tool/);
  });

  it("truncates when tool calls exceed MAX_TOOL_CALLS_PER_TURN", async () => {
    // Build a sequence where the model asks for `MAX_TOOL_CALLS_PER_TURN + 1`
    // tools across rounds. The loop should mark truncated=true and
    // force a summary turn.
    const responses: MockMessage[] = [];
    // Each round emits 2 tool_use blocks. After ceil((MAX+1)/2) rounds
    // we exceed the cap.
    const roundsBeforeCap = Math.ceil(MAX_TOOL_CALLS_PER_TURN / 2) + 1;
    for (let r = 0; r < roundsBeforeCap; r++) {
      responses.push({
        content: [
          {
            type: "tool_use",
            id: `tu_${r}_a`,
            name: "get_calendar",
            input: {},
          },
          {
            type: "tool_use",
            id: `tu_${r}_b`,
            name: "get_calendar",
            input: {},
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    }
    // Final round: model summarizes after seeing the cap-error injection.
    responses.push({
      content: [{ type: "text", text: "Hit the limit, here's what I have." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const client = makeMockClient(responses);

    const result = await runAgentLoop({
      client,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "go nuts" }],
      ctx: { userId: TEST_USER_ID, supabase: makeMockSupabase() },
    });

    expect(result.truncated).toBe(true);
    expect(result.toolCalls.length).toBeLessThanOrEqual(
      MAX_TOOL_CALLS_PER_TURN
    );
    expect(result.text).toBe("Hit the limit, here's what I have.");
  });
});
