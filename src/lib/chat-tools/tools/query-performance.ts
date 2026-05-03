import type { ChatTool, ToolContext, ToolValidationResult } from "../types";

// query_performance — filter the operator's event_performance
// aggregates (the per-event-name rolling-history derived view).
//
// This is the "by event name" lens the model needs to answer
// "what's my best repeat booking?" or "which events are still worth
// returning to?" Performance rows aren't manually edited; they're
// derived from events history server-side.

export interface QueryPerformanceInput {
  min_times_booked?: number;
  trend?: string;
  limit?: number;
}

const MAX_LIMIT = 50;
const TREND_VALUES = new Set([
  "Growing",
  "Declining",
  "Stable",
  "New/Insufficient Data",
]);

export const queryPerformanceTool: ChatTool<QueryPerformanceInput> = {
  name: "query_performance",
  description:
    "Filter the operator's event_performance aggregates — per-event-name rolling history (avg sales, times booked, trend). Use for questions about repeat events: 'which of my recurring events are growing?' or 'what's my best repeat booking?'. Sorted by avg_sales desc by default. Note: this aggregate is keyed by event_name only — there's no event_type column on event_performance, so filtering by type is NOT available here. Use query_events with event_type filter if the operator asks about a specific category.",
  inputSchema: {
    type: "object",
    properties: {
      min_times_booked: {
        type: "integer",
        minimum: 1,
        description:
          "Only include events booked at least this many times. Useful for filtering out one-shots. Optional.",
      },
      trend: {
        type: "string",
        enum: Array.from(TREND_VALUES),
        description: "Filter to a trend label. Optional.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `Max rows to return. Default ${MAX_LIMIT}, hard cap ${MAX_LIMIT}.`,
      },
    },
    additionalProperties: false,
  },

  validate(raw): ToolValidationResult<QueryPerformanceInput> {
    if (raw === null || typeof raw !== "object") {
      return { ok: false, error: "Input must be an object" };
    }
    const r = raw as Record<string, unknown>;
    const out: QueryPerformanceInput = {};
    if (r.min_times_booked !== undefined) {
      if (
        typeof r.min_times_booked !== "number" ||
        !Number.isInteger(r.min_times_booked) ||
        r.min_times_booked < 1
      ) {
        return {
          ok: false,
          error: "min_times_booked must be a positive integer",
        };
      }
      out.min_times_booked = r.min_times_booked;
    }
    if (r.trend !== undefined) {
      if (typeof r.trend !== "string" || !TREND_VALUES.has(r.trend)) {
        return {
          ok: false,
          error: `trend must be one of: ${Array.from(TREND_VALUES).join(", ")}`,
        };
      }
      out.trend = r.trend;
    }
    if (r.limit !== undefined) {
      if (
        typeof r.limit !== "number" ||
        !Number.isInteger(r.limit) ||
        r.limit < 1 ||
        r.limit > MAX_LIMIT
      ) {
        return {
          ok: false,
          error: `limit must be an integer between 1 and ${MAX_LIMIT}`,
        };
      }
      out.limit = r.limit;
    }
    return { ok: true, input: out };
  },

  async handle(input, ctx: ToolContext) {
    // Note: event_performance is keyed by event_name only — there's no
    // event_type column on this table (would require a JOIN to events).
    // Selecting event_type here threw "column does not exist" until
    // 2026-05-02. If type-filtering is needed, callers should use
    // query_events with event_type filter instead.
    let q = ctx.supabase
      .from("event_performance")
      .select("event_name, avg_sales, times_booked, trend, confidence")
      .eq("user_id", ctx.userId);

    if (input.min_times_booked !== undefined)
      q = q.gte("times_booked", input.min_times_booked);
    if (input.trend) q = q.eq("trend", input.trend);

    q = q
      .order("avg_sales", { ascending: false })
      .limit(input.limit ?? MAX_LIMIT);

    const { data, error } = await q;
    if (error) {
      throw new Error(`query_performance failed: ${error.message}`);
    }
    return { rows: data ?? [], count: data?.length ?? 0 };
  },
};
