// Tier-B chat tool surface — shared types.
//
// Tools are typed handlers the model can call mid-conversation to
// fetch scoped data from the operator's account. Each tool:
//   * declares its name + description + JSON-schema input shape
//     (consumed by the Anthropic SDK as the `tools` parameter)
//   * validates the model-supplied input at runtime (the model can
//     and will produce inputs that don't match the schema)
//   * runs against an auth-scoped Supabase client (so RLS does the
//     hard work of preventing cross-user data leaks — even if the
//     model tries to swap a user_id in the tool input, RLS denies
//     the read)
//
// PR #1 of the Tier-B workstream lands the framework + a starting
// surface of three tools. The /api/chat-v2 endpoint (PR #2) will
// import the registry and run an agent loop. No user-visible change
// in this PR.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The runtime context the agent loop hands to a tool. Carries the
 * authenticated user id (used to scope queries explicitly even though
 * RLS would already enforce it — defense-in-depth) and the Supabase
 * client to query through. The client is created with the operator's
 * session, NOT the service role — RLS is the load-bearing guard.
 */
export interface ToolContext {
  userId: string;
  supabase: SupabaseClient;
}

/**
 * Anthropic tools API expects a JSON-schema-shaped input_schema. We
 * keep the type narrow so a typo in a tool definition is caught at
 * compile time.
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export type JsonSchemaProperty =
  | { type: "string"; enum?: string[]; description?: string; format?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string }
  | { type: "integer"; minimum?: number; maximum?: number; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "array"; items: JsonSchemaProperty; description?: string };

/**
 * Result of calling a tool. The agent loop will JSON-serialize this
 * into a tool_result block. Keeping the type loose (`unknown`) lets
 * each tool return whatever shape the model can read most easily —
 * usually a small object or array of rows.
 */
export type ToolResult = unknown;

/**
 * Validation outcome — keep it as a discriminated union so callers
 * can branch cleanly without relying on thrown exceptions for control
 * flow.
 */
export type ToolValidationResult<TInput> =
  | { ok: true; input: TInput }
  | { ok: false; error: string };

export interface ChatTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /**
   * Validate + narrow the model-supplied input. Reject anything
   * out-of-shape with a short human-readable reason — the agent loop
   * forwards the message back to the model as a tool_result error.
   */
  validate(raw: unknown): ToolValidationResult<TInput>;
  /**
   * Execute the tool. May throw — the agent loop catches and reports
   * back as a tool_result error. Don't expose internal error details
   * verbatim; map to operator-friendly messages.
   */
  handle(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * The tool's name → tool mapping the registry exposes. Keyed by name
 * for O(1) dispatch from a model-supplied tool_use block.
 */
export type ToolRegistry = Map<string, ChatTool<unknown>>;

/**
 * Hard cap on tool calls per turn — prevents runaway loops if the
 * model keeps reaching for tools instead of producing a final answer.
 * The agent loop should stop after this and ask for a summary.
 */
export const MAX_TOOL_CALLS_PER_TURN = 6;
