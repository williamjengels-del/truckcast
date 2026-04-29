import type Anthropic from "@anthropic-ai/sdk";
import {
  chatToolsRegistry,
  toAnthropicTools,
  getTool,
  MAX_TOOL_CALLS_PER_TURN,
} from "./index";
import type { ToolContext } from "./types";

// Tier-B agent loop.
//
// Drives a multi-round conversation between the model and the local
// tool surface from chat-tools/index.ts. Each round:
//   1. Send the conversation + tools to Anthropic.
//   2. If the model emits tool_use blocks, dispatch each through the
//      registry, validate the input, run the handler, push tool_result
//      blocks back into the conversation.
//   3. Repeat until stop_reason === "end_turn" OR we hit
//      MAX_TOOL_CALLS_PER_TURN (cumulative across the loop).
//
// The loop is extracted from the route handler so it's testable
// without spinning up an actual Next.js request — see agent-loop.test.ts.

export interface AgentLoopArgs {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  /**
   * The user-side conversation history (without tool_use / tool_result
   * blocks — those are managed inside the loop). Last entry must be
   * the latest user message.
   */
  messages: Anthropic.MessageParam[];
  ctx: ToolContext;
  maxTokens?: number;
}

export interface AgentToolCall {
  name: string;
  input: unknown;
  result?: unknown;
  /** Set when the tool failed validation or threw during handle. */
  error?: string;
}

export interface AgentLoopResult {
  /** Final assistant text — empty string if the loop ended without a text block. */
  text: string;
  /** Every tool call attempted, in order. Used for transparency in the UI. */
  toolCalls: AgentToolCall[];
  /** stop_reason from the final Anthropic response. */
  stopReason: string;
  /** Cumulative usage across all rounds. */
  usage: { input_tokens: number; output_tokens: number };
  /** True if we hit the MAX_TOOL_CALLS_PER_TURN cap and forced a stop. */
  truncated: boolean;
}

const DEFAULT_MAX_TOKENS = 2048;

export async function runAgentLoop({
  client,
  model,
  systemPrompt,
  messages,
  ctx,
  maxTokens = DEFAULT_MAX_TOKENS,
}: AgentLoopArgs): Promise<AgentLoopResult> {
  const tools = toAnthropicTools(chatToolsRegistry);
  const conversation: Anthropic.MessageParam[] = [...messages];
  const toolCalls: AgentToolCall[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let truncated = false;

  // The loop is bounded — at most MAX_TOOL_CALLS_PER_TURN tool-call
  // rounds plus one final round for the model to summarize. Adding +2
  // as a hard upper bound so a malformed Anthropic response can't
  // hang us indefinitely.
  for (let round = 0; round < MAX_TOOL_CALLS_PER_TURN + 2; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: conversation,
      tools,
    });

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const text = textBlocks.map((b) => b.text).join("");

    // Final response from the model (no tools requested OR end_turn).
    if (toolUses.length === 0 || response.stop_reason === "end_turn") {
      return {
        text,
        toolCalls,
        stopReason: response.stop_reason ?? "end_turn",
        usage,
        truncated,
      };
    }

    // Cap reached — push synthetic tool_result errors and force a
    // summary turn. The model will see "tool call limit reached" and
    // produce a final text block on the next round.
    if (toolCalls.length + toolUses.length > MAX_TOOL_CALLS_PER_TURN) {
      truncated = true;
      conversation.push({ role: "assistant", content: response.content });
      conversation.push({
        role: "user",
        content: toolUses.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content:
            "Tool call limit reached for this turn. Summarize what you have so far without calling more tools.",
          is_error: true,
        })),
      });
      continue;
    }

    // Push assistant message with the tool_use blocks, then dispatch
    // each tool and push back tool_result blocks in one combined user
    // message (Anthropic expects results batched, not interleaved).
    conversation.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tool = getTool(chatToolsRegistry, tu.name);
      let result: unknown;
      let errorMsg: string | undefined;

      if (!tool) {
        errorMsg = `Unknown tool: ${tu.name}`;
      } else {
        const validation = tool.validate(tu.input);
        if (!validation.ok) {
          errorMsg = `Invalid input: ${validation.error}`;
        } else {
          try {
            result = await tool.handle(validation.input, ctx);
          } catch (err) {
            errorMsg = err instanceof Error ? err.message : String(err);
          }
        }
      }

      toolCalls.push({ name: tu.name, input: tu.input, result, error: errorMsg });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: errorMsg ? `Error: ${errorMsg}` : safeJsonStringify(result),
        is_error: !!errorMsg,
      });
    }

    conversation.push({ role: "user", content: toolResults });
  }

  // Should be unreachable under MAX_TOOL_CALLS_PER_TURN + 2 rounds,
  // but keep a safe fallback so the loop is total.
  return {
    text: "",
    toolCalls,
    stopReason: "max_rounds_exceeded",
    usage,
    truncated: true,
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
