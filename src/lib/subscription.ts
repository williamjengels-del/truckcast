import type { SubscriptionTier } from "./database.types";

/**
 * Feature gating based on subscription tier.
 */
export const FEATURE_ACCESS: Record<string, SubscriptionTier[]> = {
  // Starter features (all tiers)
  events: ["starter", "pro", "premium"],
  manual_sales: ["starter", "pro", "premium"],
  performance: ["starter", "pro", "premium"],
  dashboard: ["starter", "pro", "premium"],
  fee_calculator: ["starter", "pro", "premium"],
  contacts: ["starter", "pro", "premium"],

  // Pro features
  pos_integration: ["pro", "premium"],
  weather_forecasts: ["pro", "premium"],
  public_schedule: ["pro", "premium"],
  csv_import: ["pro", "premium"],

  // Premium features
  organizer_scoring: ["premium"],
  risk_analysis: ["premium"],
  monthly_reports: ["premium"],
  anomaly_detection: ["premium"],
  confidence_bands: ["premium"],
};

export function hasAccess(
  tier: SubscriptionTier,
  feature: string
): boolean {
  const allowed = FEATURE_ACCESS[feature];
  if (!allowed) return true; // Unknown features are allowed by default
  return allowed.includes(tier);
}

export function getRequiredTier(feature: string): SubscriptionTier {
  const allowed = FEATURE_ACCESS[feature];
  if (!allowed || allowed.includes("starter")) return "starter";
  if (allowed.includes("pro")) return "pro";
  return "premium";
}
