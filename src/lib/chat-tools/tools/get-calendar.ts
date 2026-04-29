import type { ChatTool, ToolContext, ToolValidationResult } from "../types";

// get_calendar — upcoming booked events, ordered by date.
//
// Closest analog to the dashboard sidebar's "what's next?" widget.
// Use when the operator asks "what's on my calendar?" or "what's
// coming up Saturday?".

export interface GetCalendarInput {
  weeks_ahead?: number;
}

const DEFAULT_WEEKS_AHEAD = 4;
const MAX_WEEKS_AHEAD = 26;

export const getCalendarTool: ChatTool<GetCalendarInput> = {
  name: "get_calendar",
  description:
    "Upcoming booked events for the operator, sorted by date ascending. Returns events from today through `weeks_ahead` weeks out (default 4, max 26). Cancelled events excluded.",
  inputSchema: {
    type: "object",
    properties: {
      weeks_ahead: {
        type: "integer",
        minimum: 1,
        maximum: MAX_WEEKS_AHEAD,
        description: `Lookahead window in weeks. Default ${DEFAULT_WEEKS_AHEAD}, max ${MAX_WEEKS_AHEAD}.`,
      },
    },
    additionalProperties: false,
  },

  validate(raw): ToolValidationResult<GetCalendarInput> {
    if (raw === null || typeof raw !== "object") {
      return { ok: false, error: "Input must be an object" };
    }
    const r = raw as Record<string, unknown>;
    const out: GetCalendarInput = {};
    if (r.weeks_ahead !== undefined) {
      if (
        typeof r.weeks_ahead !== "number" ||
        !Number.isInteger(r.weeks_ahead) ||
        r.weeks_ahead < 1 ||
        r.weeks_ahead > MAX_WEEKS_AHEAD
      ) {
        return {
          ok: false,
          error: `weeks_ahead must be an integer between 1 and ${MAX_WEEKS_AHEAD}`,
        };
      }
      out.weeks_ahead = r.weeks_ahead;
    }
    return { ok: true, input: out };
  },

  async handle(input, ctx: ToolContext) {
    const weeks = input.weeks_ahead ?? DEFAULT_WEEKS_AHEAD;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + weeks * 7);
    const horizonStr = horizon.toISOString().slice(0, 10);

    const { data, error } = await ctx.supabase
      .from("events")
      .select(
        "event_name, event_date, start_time, end_time, location, city, event_type, event_mode"
      )
      .eq("user_id", ctx.userId)
      .eq("booked", true)
      .is("cancellation_reason", null)
      .gte("event_date", todayStr)
      .lte("event_date", horizonStr)
      .order("event_date", { ascending: true });

    if (error) {
      throw new Error(`get_calendar failed: ${error.message}`);
    }
    return {
      from: todayStr,
      to: horizonStr,
      rows: data ?? [],
      count: data?.length ?? 0,
    };
  },
};
