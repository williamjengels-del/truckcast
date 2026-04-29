import type Anthropic from "@anthropic-ai/sdk";
import type { ChatTool, ToolRegistry } from "./types";

// Tool registry + dispatch.
//
// The registry is constructed once at import time and used by the
// /api/chat-v2 agent loop to:
//   - emit the tool list as the Anthropic `tools` parameter
//   - dispatch a `tool_use` block by name to the matching handler
//
// New tools are added to the array in tools.ts and re-exported via
// the index. Adding a tool is one file change.

export function buildRegistry(tools: ChatTool[]): ToolRegistry {
  const reg: ToolRegistry = new Map();
  for (const tool of tools) {
    if (reg.has(tool.name)) {
      throw new Error(
        `Duplicate chat tool name: ${tool.name}. Tool names must be unique.`
      );
    }
    reg.set(tool.name, tool);
  }
  return reg;
}

/**
 * Anthropic-shape tool list — pass directly as `tools` in the
 * messages.create / messages.stream call.
 *
 * The cast on input_schema bridges our narrow ToolInputSchema (which
 * gives compile-time safety on tool definitions) to the SDK's
 * loosely-typed Anthropic.Tool.input_schema (carries an index
 * signature). Both describe the same JSON-schema shape; the cast is
 * sound, and keeping the narrow type at definition time catches typos
 * the SDK shape wouldn't.
 */
export function toAnthropicTools(reg: ToolRegistry): Anthropic.Tool[] {
  return Array.from(reg.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as unknown as Anthropic.Tool["input_schema"],
  }));
}

export function getTool(reg: ToolRegistry, name: string): ChatTool | undefined {
  return reg.get(name);
}
