import { describe, it, expect } from "vitest";
import {
  chatToolsRegistry,
  toAnthropicTools,
  getTool,
  MAX_TOOL_CALLS_PER_TURN,
} from "./index";
import { queryEventsTool } from "./tools/query-events";
import { queryPerformanceTool } from "./tools/query-performance";
import { getCalendarTool } from "./tools/get-calendar";

describe("chat-tools registry", () => {
  it("exposes all three tools", () => {
    expect(chatToolsRegistry.size).toBe(3);
    expect(chatToolsRegistry.has("query_events")).toBe(true);
    expect(chatToolsRegistry.has("query_performance")).toBe(true);
    expect(chatToolsRegistry.has("get_calendar")).toBe(true);
  });

  it("getTool retrieves by name", () => {
    expect(getTool(chatToolsRegistry, "query_events")).toBe(queryEventsTool);
    expect(getTool(chatToolsRegistry, "nope")).toBeUndefined();
  });

  it("toAnthropicTools emits the SDK shape", () => {
    const tools = toAnthropicTools(chatToolsRegistry);
    expect(tools).toHaveLength(3);
    for (const t of tools) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("input_schema");
      // The SDK's input_schema is a JSON-schema object — at minimum
      // we expect the type=object envelope and a properties bag.
      expect(t.input_schema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
      });
    }
  });

  it("MAX_TOOL_CALLS_PER_TURN is sensible", () => {
    // Loose sanity: not 0 (would disable the loop), not absurdly high
    // (would let the model spin DB queries indefinitely).
    expect(MAX_TOOL_CALLS_PER_TURN).toBeGreaterThan(0);
    expect(MAX_TOOL_CALLS_PER_TURN).toBeLessThanOrEqual(20);
  });
});

describe("queryEventsTool.validate", () => {
  it("accepts an empty input (all filters optional)", () => {
    const r = queryEventsTool.validate({});
    expect(r.ok).toBe(true);
  });

  it("accepts well-formed inputs", () => {
    const r = queryEventsTool.validate({
      event_type: "Festival",
      date_from: "2025-01-01",
      date_to: "2025-12-31",
      min_net_sales: 500,
      booked_only: true,
      limit: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.event_type).toBe("Festival");
      expect(r.input.limit).toBe(20);
    }
  });

  it("rejects malformed dates", () => {
    const r = queryEventsTool.validate({ date_from: "01/01/2025" });
    expect(r.ok).toBe(false);
  });

  it("rejects out-of-range limit", () => {
    expect(queryEventsTool.validate({ limit: 0 }).ok).toBe(false);
    expect(queryEventsTool.validate({ limit: 51 }).ok).toBe(false);
    expect(queryEventsTool.validate({ limit: 1.5 }).ok).toBe(false);
  });

  it("rejects negative min_net_sales", () => {
    expect(queryEventsTool.validate({ min_net_sales: -1 }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(queryEventsTool.validate(null).ok).toBe(false);
    expect(queryEventsTool.validate("string").ok).toBe(false);
    expect(queryEventsTool.validate(42).ok).toBe(false);
  });
});

describe("queryPerformanceTool.validate", () => {
  it("rejects unknown trend values", () => {
    const r = queryPerformanceTool.validate({ trend: "Excellent" });
    expect(r.ok).toBe(false);
  });

  it("accepts valid trend values", () => {
    expect(queryPerformanceTool.validate({ trend: "Growing" }).ok).toBe(true);
    expect(queryPerformanceTool.validate({ trend: "Declining" }).ok).toBe(true);
  });

  it("rejects min_times_booked < 1", () => {
    expect(queryPerformanceTool.validate({ min_times_booked: 0 }).ok).toBe(false);
  });
});

describe("getCalendarTool.validate", () => {
  it("rejects weeks_ahead out of bounds", () => {
    expect(getCalendarTool.validate({ weeks_ahead: 0 }).ok).toBe(false);
    expect(getCalendarTool.validate({ weeks_ahead: 27 }).ok).toBe(false);
    expect(getCalendarTool.validate({ weeks_ahead: 4.5 }).ok).toBe(false);
  });

  it("accepts valid weeks_ahead", () => {
    expect(getCalendarTool.validate({ weeks_ahead: 1 }).ok).toBe(true);
    expect(getCalendarTool.validate({ weeks_ahead: 26 }).ok).toBe(true);
  });

  it("accepts empty input (defaults applied at handle-time)", () => {
    expect(getCalendarTool.validate({}).ok).toBe(true);
  });
});

describe("tool input_schema shape", () => {
  // Lightweight check that each tool's schema has the required envelope
  // shape Anthropic expects.
  for (const tool of [queryEventsTool, queryPerformanceTool, getCalendarTool]) {
    it(`${tool.name} input_schema is an object with properties`, () => {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    });
  }
});
