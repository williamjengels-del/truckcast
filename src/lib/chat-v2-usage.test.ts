import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeCostCents,
  chatV2MonthlyCapCents,
  CHAT_V2_DEFAULT_CAP_CENTS,
  monthToDateCostCents,
  checkMonthlyCap,
  SONNET_INPUT_CENTS_PER_MTOK,
  SONNET_OUTPUT_CENTS_PER_MTOK,
} from "./chat-v2-usage";

// Tests for the Tier-B usage telemetry pure surface. The DB-touching
// functions are exercised against a minimal Supabase mock that
// returns scripted rows without spinning up a real client.

describe("computeCostCents", () => {
  it("returns 0 for 0 tokens", () => {
    expect(computeCostCents({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });

  it("matches the published Sonnet pricing for 1M tokens of each", () => {
    // 1M input × $3 + 1M output × $15 = $18.00 = 1800 cents
    expect(
      computeCostCents({ input_tokens: 1_000_000, output_tokens: 1_000_000 })
    ).toBe(SONNET_INPUT_CENTS_PER_MTOK + SONNET_OUTPUT_CENTS_PER_MTOK);
  });

  it("ceils fractional cents (no under-charge over many requests)", () => {
    // 1 input + 1 output = (300/1M + 1500/1M) = 0.0018 cents → ceil to 1
    expect(computeCostCents({ input_tokens: 1, output_tokens: 1 })).toBe(1);
  });

  it("a typical Tier-B turn (5k in + 1k out) costs ~3 cents", () => {
    // 5000 × 300 / 1M + 1000 × 1500 / 1M = 1.5 + 1.5 = 3.0 cents
    expect(
      computeCostCents({ input_tokens: 5_000, output_tokens: 1_000 })
    ).toBe(3);
  });
});

describe("chatV2MonthlyCapCents", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.CHAT_V2_MONTHLY_CAP_CENTS;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CHAT_V2_MONTHLY_CAP_CENTS;
    else process.env.CHAT_V2_MONTHLY_CAP_CENTS = savedEnv;
  });

  it("defaults to $10 when env var unset", () => {
    delete process.env.CHAT_V2_MONTHLY_CAP_CENTS;
    expect(chatV2MonthlyCapCents()).toBe(CHAT_V2_DEFAULT_CAP_CENTS);
    expect(CHAT_V2_DEFAULT_CAP_CENTS).toBe(1000);
  });

  it("respects env var override", () => {
    process.env.CHAT_V2_MONTHLY_CAP_CENTS = "2500";
    expect(chatV2MonthlyCapCents()).toBe(2500);
  });

  it("falls back to default on garbage env", () => {
    process.env.CHAT_V2_MONTHLY_CAP_CENTS = "not-a-number";
    expect(chatV2MonthlyCapCents()).toBe(CHAT_V2_DEFAULT_CAP_CENTS);
    process.env.CHAT_V2_MONTHLY_CAP_CENTS = "-100";
    expect(chatV2MonthlyCapCents()).toBe(CHAT_V2_DEFAULT_CAP_CENTS);
    process.env.CHAT_V2_MONTHLY_CAP_CENTS = "0";
    expect(chatV2MonthlyCapCents()).toBe(CHAT_V2_DEFAULT_CAP_CENTS);
  });
});

// Minimal Supabase mock shaped just enough for the two helpers under
// test. Captures the gte filter so we can assert the month boundary.
function makeMockSupabase(rows: Array<{ cost_cents: number }>) {
  let lastGteValue: string | null = null;
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: (_col: string, value: string) => {
      lastGteValue = value;
      return builder;
    },
    then: (resolve: (v: { data: typeof rows; error: null }) => void) => {
      resolve({ data: rows, error: null });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    client: {
      from: () => builder,
    } as unknown as Parameters<typeof monthToDateCostCents>[0],
    getLastGte: () => lastGteValue,
  };
}

describe("monthToDateCostCents", () => {
  it("sums cost_cents across the returned rows", async () => {
    const mock = makeMockSupabase([
      { cost_cents: 25 },
      { cost_cents: 50 },
      { cost_cents: 100 },
    ]);
    const total = await monthToDateCostCents(mock.client, "user-1");
    expect(total).toBe(175);
  });

  it("returns 0 when the table has no rows", async () => {
    const mock = makeMockSupabase([]);
    expect(await monthToDateCostCents(mock.client, "user-1")).toBe(0);
  });

  it("uses UTC month boundary in the gte filter", async () => {
    const mock = makeMockSupabase([]);
    const fixedNow = new Date("2026-04-28T15:30:00Z");
    await monthToDateCostCents(mock.client, "user-1", fixedNow);
    expect(mock.getLastGte()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("checkMonthlyCap", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.CHAT_V2_MONTHLY_CAP_CENTS;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CHAT_V2_MONTHLY_CAP_CENTS;
    else process.env.CHAT_V2_MONTHLY_CAP_CENTS = savedEnv;
  });

  it("returns ok when under the cap", async () => {
    delete process.env.CHAT_V2_MONTHLY_CAP_CENTS;
    const mock = makeMockSupabase([{ cost_cents: 200 }]);
    const result = await checkMonthlyCap(mock.client, "user-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spentCents).toBe(200);
      expect(result.capCents).toBe(1000);
    }
  });

  it("returns not-ok when at or over the cap", async () => {
    delete process.env.CHAT_V2_MONTHLY_CAP_CENTS;
    const mock = makeMockSupabase([{ cost_cents: 1100 }]);
    const result = await checkMonthlyCap(mock.client, "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.spentCents).toBe(1100);
      expect(result.capCents).toBe(1000);
      expect(result.reason).toMatch(/cap reached/i);
      expect(result.reason).toContain("$10.00");
    }
  });

  it("treats spent === cap as over (defensive — exact boundary)", async () => {
    delete process.env.CHAT_V2_MONTHLY_CAP_CENTS;
    const mock = makeMockSupabase([{ cost_cents: 1000 }]);
    const result = await checkMonthlyCap(mock.client, "user-1");
    expect(result.ok).toBe(false);
  });

  it("respects custom cap from env var in the message", async () => {
    process.env.CHAT_V2_MONTHLY_CAP_CENTS = "2500";
    const mock = makeMockSupabase([{ cost_cents: 2600 }]);
    const result = await checkMonthlyCap(mock.client, "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("$25.00");
    }
  });
});
