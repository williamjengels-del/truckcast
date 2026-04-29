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
 */
export function toAnthropicTools(reg: ToolRegistry) {
  return Array.from(reg.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export function getTool(reg: ToolRegistry, name: string): ChatTool | undefined {
  return reg.get(name);
}
