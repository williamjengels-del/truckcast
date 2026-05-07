/**
 * Tests for the recalc pipeline's Bayesian shadow-write payload.
 * Pinning the engine-result → DB-column mapping so a future refactor
 * doesn't silently drop a field or rename a column out of sync with
 * the migration.
 *
 * The full recalc loop has plenty of integration-shaped behavior
 * (Supabase auth, weather classification, platform registry writes)
 * that's covered by manual run-against-prod and the existing
 * comparison scripts. The unit test here focuses on the one place
 * where engine output meets DB schema.
 */

import { describe, it, expect } from "vitest";
import { bayesianShadowUpdate } from "./recalculate";
import type { BayesianForecastResult } from "./forecast-engine-v2";

function makeV2Result(overrides: Partial<BayesianForecastResult> = {}): BayesianForecastResult {
  return {
    point: 1234.56,
    credibleLow: 600,
    credibleHigh: 2400,
    credible50Low: 900,
    credible50High: 1700,
    personalObservations: 7,
    priorSource: "operator",
    posterior: { muN: 7.1, kappaN: 7.5, alphaN: 5.5, betaN: 0.6 },
    weatherCoefficient: 1.0,
    dayOfWeekCoefficient: 1.0,
    holidayCoefficient: 1.0,
    weatherSource: "none",
    insufficientData: false,
    ...overrides,
  };
}

describe("bayesianShadowUpdate", () => {
  it("maps every engine output field to its corresponding shadow column", () => {
    const v2 = makeV2Result();
    const update = bayesianShadowUpdate(v2);
    expect(update.forecast_bayesian_point).toBe(1234.56);
    expect(update.forecast_bayesian_low_80).toBe(600);
    expect(update.forecast_bayesian_high_80).toBe(2400);
    expect(update.forecast_bayesian_low_50).toBe(900);
    expect(update.forecast_bayesian_high_50).toBe(1700);
    expect(update.forecast_bayesian_n_obs).toBe(7);
    expect(update.forecast_bayesian_prior_src).toBe("operator");
    expect(update.forecast_bayesian_insufficient).toBe(false);
    expect(typeof update.forecast_bayesian_computed_at).toBe("string");
    // computed_at is an ISO timestamp — should be parseable.
    expect(Number.isFinite(Date.parse(update.forecast_bayesian_computed_at))).toBe(true);
  });

  it("preserves the insufficientData flag in the shadow payload", () => {
    // Unlike the v1 update path which nulls forecast_sales when
    // insufficient, the shadow path keeps the point and flags it.
    // The calibration report uses this to audit floor behavior.
    const update = bayesianShadowUpdate(makeV2Result({ insufficientData: true, point: 12 }));
    expect(update.forecast_bayesian_point).toBe(12);
    expect(update.forecast_bayesian_insufficient).toBe(true);
  });

  it("maps each prior source value through to the column verbatim", () => {
    for (const src of ["platform", "operator", "default"] as const) {
      const update = bayesianShadowUpdate(makeV2Result({ priorSource: src }));
      expect(update.forecast_bayesian_prior_src).toBe(src);
    }
  });
});
