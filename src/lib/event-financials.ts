// Helpers for stripping financial fields off Event rows before
// rendering for managers without Financials access.
//
// The Operations grant (always on for managers) requires reading
// event rows — managers need to see what's booked, when, where, who
// the contact is, what the notes say. The Financials toggle gates
// the dollar information layered on top. RLS allows the read of the
// full row; we strip on the server before passing to the client so
// downstream UI naturally renders nothing for null values without
// touching every component.

import type { Event } from "@/lib/database.types";

const FINANCIAL_FIELDS = [
  "net_sales",
  "forecast_sales",
  "invoice_revenue",
  "sales_minimum",
  "fee_rate",
  "food_cost_dollars",
  "food_cost_pct",
  "food_cost_method",
  "fee_type",
  "fee_amount",
] as const;

export function stripFinancialFields(event: Event): Event {
  const stripped: Record<string, unknown> = { ...event };
  for (const k of FINANCIAL_FIELDS) {
    if (k in stripped) stripped[k] = null;
  }
  return stripped as unknown as Event;
}
