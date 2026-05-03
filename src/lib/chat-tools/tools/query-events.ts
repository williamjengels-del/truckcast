import type { ChatTool, ToolContext, ToolValidationResult } from "../types";

// query_events — filter the operator's events.
//
// Lets the model ask for a slice of the event history. RLS scopes
// the read to the calling user; we re-apply the filter explicitly
// for clarity. Hard caps on limit + date range protect against the
// model asking for everything.

export interface QueryEventsInput {
  event_type?: string;
  weather?: string;
  date_from?: string;
  date_to?: string;
  min_net_sales?: number;
  booked_only?: boolean;
  limit?: number;
}

const MAX_LIMIT = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const queryEventsTool: ChatTool<QueryEventsInput> = {
  name: "query_events",
  description:
    "Filter the operator's event history. Returns up to 50 rows. Use for questions like 'show me my August catering events' or 'what did I make at festivals last summer'. Date inputs are YYYY-MM-DD. Filters AND together. **By default returns ONLY booked events** — for 'what's coming up', 'next two weeks', 'upcoming events' style questions, leave booked_only unset (or true). Only set booked_only=false when the operator explicitly asks about unbooked inquiries, prospects, leads, or cancellations.",
  inputSchema: {
    type: "object",
    properties: {
      event_type: {
        type: "string",
        description:
          "Filter to one event type (Festival, Concert, Wedding, etc.). Optional.",
      },
      weather: {
        type: "string",
        description:
          "Filter to a weather class (Clear, Rain During Event, etc.). Optional.",
      },
      date_from: {
        type: "string",
        format: "date",
        description: "Inclusive lower bound on event_date (YYYY-MM-DD). Optional.",
      },
      date_to: {
        type: "string",
        format: "date",
        description: "Inclusive upper bound on event_date (YYYY-MM-DD). Optional.",
      },
      min_net_sales: {
        type: "number",
        minimum: 0,
        description: "Only rows with net_sales >= this. Optional.",
      },
      booked_only: {
        type: "boolean",
        description: "Default true. **Only set to false when the operator EXPLICITLY mentions unbooked, inquiries, prospects, leads, cancellations, or asks 'what's pending?' / 'what hasn't been confirmed?'.** For neutral questions like 'upcoming events' or 'what's next', leave unset (defaults to booked-only). Setting false includes both unbooked AND cancelled events.",
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

  validate(raw): ToolValidationResult<QueryEventsInput> {
    if (raw === null || typeof raw !== "object") {
      return { ok: false, error: "Input must be an object" };
    }
    const r = raw as Record<string, unknown>;
    const out: QueryEventsInput = {};
    if (r.event_type !== undefined) {
      if (typeof r.event_type !== "string") {
        return { ok: false, error: "event_type must be a string" };
      }
      out.event_type = r.event_type;
    }
    if (r.weather !== undefined) {
      if (typeof r.weather !== "string") {
        return { ok: false, error: "weather must be a string" };
      }
      out.weather = r.weather;
    }
    if (r.date_from !== undefined) {
      if (typeof r.date_from !== "string" || !ISO_DATE.test(r.date_from)) {
        return { ok: false, error: "date_from must be YYYY-MM-DD" };
      }
      out.date_from = r.date_from;
    }
    if (r.date_to !== undefined) {
      if (typeof r.date_to !== "string" || !ISO_DATE.test(r.date_to)) {
        return { ok: false, error: "date_to must be YYYY-MM-DD" };
      }
      out.date_to = r.date_to;
    }
    if (r.min_net_sales !== undefined) {
      if (typeof r.min_net_sales !== "number" || r.min_net_sales < 0) {
        return { ok: false, error: "min_net_sales must be a non-negative number" };
      }
      out.min_net_sales = r.min_net_sales;
    }
    if (r.booked_only !== undefined) {
      if (typeof r.booked_only !== "boolean") {
        return { ok: false, error: "booked_only must be a boolean" };
      }
      out.booked_only = r.booked_only;
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
    let q = ctx.supabase
      .from("events")
      .select(
        "event_name, event_date, event_type, net_sales, forecast_sales, location, city, event_weather, event_mode, booked"
      )
      .eq("user_id", ctx.userId);

    if (input.booked_only !== false) {
      q = q.eq("booked", true).is("cancellation_reason", null);
    }
    if (input.event_type) q = q.eq("event_type", input.event_type);
    if (input.weather) q = q.eq("event_weather", input.weather);
    if (input.date_from) q = q.gte("event_date", input.date_from);
    if (input.date_to) q = q.lte("event_date", input.date_to);
    if (input.min_net_sales !== undefined)
      q = q.gte("net_sales", input.min_net_sales);

    q = q.order("event_date", { ascending: false }).limit(input.limit ?? MAX_LIMIT);

    const { data, error } = await q;
    if (error) {
      throw new Error(`query_events failed: ${error.message}`);
    }
    return { rows: data ?? [], count: data?.length ?? 0 };
  },
};
