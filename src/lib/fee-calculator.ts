/**
 * Fee calculator — shared business logic for computing event fees and net revenue.
 *
 * Fee types:
 *   none                  — no fee, net = gross
 *   flat_fee              — fixed dollar amount deducted (e.g. $150 booth fee)
 *   percentage            — % of gross sales (e.g. 10%)
 *   commission_with_minimum — higher of a % of gross OR a fixed minimum
 *   pre_settled           — payment already settled; fee field holds the agreed amount
 */

import type { FeeType } from "./database.types";

/**
 * Calculate the fee amount for an event.
 *
 * @param gross         - Gross (net) sales for the event
 * @param feeType       - One of the FeeType enum values
 * @param feeRate       - Dollar amount (flat_fee) or percentage (percentage / commission)
 * @param salesMinimum  - Floor for commission_with_minimum (ignored for other types)
 * @returns             - Fee amount in dollars (always >= 0)
 */
export function calcEventFee(
  gross: number,
  feeType: FeeType | string,
  feeRate: number,
  salesMinimum: number = 0
): number {
  if (gross < 0) return 0;
  switch (feeType) {
    case "flat_fee":
      return Math.max(0, feeRate);
    case "percentage":
      return Math.max(0, gross * (feeRate / 100));
    case "commission_with_minimum":
      return Math.max(salesMinimum, gross * (feeRate / 100));
    case "pre_settled":
      // pre_settled events store the agreed payout in fee_rate; fee is effectively 0
      return 0;
    case "none":
    default:
      return 0;
  }
}

/**
 * Calculate net revenue after fees.
 *
 * @param gross         - Gross sales
 * @param feeType       - Fee type
 * @param feeRate       - Fee amount or rate
 * @param salesMinimum  - Minimum for commission_with_minimum
 * @returns             - Net revenue (always >= 0)
 */
export function calcNetAfterFees(
  gross: number,
  feeType: FeeType | string,
  feeRate: number,
  salesMinimum: number = 0
): number {
  const fee = calcEventFee(gross, feeType, feeRate, salesMinimum);
  return Math.max(0, gross - fee);
}
