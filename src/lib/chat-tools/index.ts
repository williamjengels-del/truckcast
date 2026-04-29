// Public surface of the Tier-B chat-tools framework.
//
// Consumers (the future /api/chat-v2 agent loop) get:
//   - registry          : Map<name, ChatTool>
//   - toAnthropicTools  : tools array shaped for messages.create({ tools })
//   - getTool           : O(1) lookup by name for tool_use dispatch

import { buildRegistry, toAnthropicTools, getTool } from "./registry";
import { queryEventsTool } from "./tools/query-events";
import { queryPerformanceTool } from "./tools/query-performance";
import { getCalendarTool } from "./tools/get-calendar";

// Order here doesn't affect dispatch (Map keyed by name) but does
// drive the order Anthropic sees the tools in. Put the ones the model
// is most likely to reach for first.
const TOOLS = [queryEventsTool, queryPerformanceTool, getCalendarTool];

export const chatToolsRegistry = buildRegistry(TOOLS);

export { toAnthropicTools, getTool };
export type { ChatTool, ToolContext, ToolResult } from "./types";
export { MAX_TOOL_CALLS_PER_TURN } from "./types";
