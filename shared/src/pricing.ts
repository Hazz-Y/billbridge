import { mulDivFloor } from './money.js';

/**
 * Pricing math (spec 4.7). Integer only. Discount is an ANNUALIZED rate (bps) prorated by tenor.
 *
 * tenorDays          = max(1, days(listedAt -> dueDate))
 * discountPerUnit    = floor(unitFace * discountBps * tenorDays / (365 * 10000))
 * pricePerUnitPaise  = unitFace - discountPerUnit
 * yieldPerUnitPaise  = discountPerUnit
 * annualizedYieldBps = floor(yieldPerUnit * 365 * 10000 / (pricePerUnit * tenorDays))
 *
 * Worked example: unit 100000, 800 bps, 67 days -> discount 1468, price 98532, yield 811 bps.
 */
export interface Pricing {
  unitFaceValuePaise: number;
  discountBps: number;
  tenorDays: number;
  discountPerUnitPaise: number;
  pricePerUnitPaise: number;
  yieldPerUnitPaise: number;
  annualizedYieldBps: number;
}

export function computePricing(unitFaceValuePaise: number, discountBps: number, tenorDays: number): Pricing {
  if (!Number.isSafeInteger(unitFaceValuePaise) || unitFaceValuePaise <= 0) throw new Error('unitFaceValuePaise must be a positive integer');
  if (!Number.isSafeInteger(discountBps) || discountBps < 0) throw new Error('discountBps must be a non-negative integer');
  if (!Number.isSafeInteger(tenorDays) || tenorDays < 1) throw new Error('tenorDays must be >= 1');
  const discountPerUnitPaise = mulDivFloor(unitFaceValuePaise * discountBps, tenorDays, 365 * 10000);
  const pricePerUnitPaise = unitFaceValuePaise - discountPerUnitPaise;
  if (pricePerUnitPaise <= 0) throw new Error('discount exceeds face value');
  const annualizedYieldBps = mulDivFloor(discountPerUnitPaise * 365, 10000, pricePerUnitPaise * tenorDays);
  return {
    unitFaceValuePaise, discountBps, tenorDays, discountPerUnitPaise, pricePerUnitPaise,
    yieldPerUnitPaise: discountPerUnitPaise, annualizedYieldBps,
  };
}

/** Expected return for `units` at maturity (face - cost), integer paise. */
export function expectedReturnPaise(units: number, unitFaceValuePaise: number, pricePerUnitPaise: number): number {
  return units * (unitFaceValuePaise - pricePerUnitPaise);
}

/**
 * Accrued (unrealized) yield, integer: floor(totalYield * elapsedDays / tenorDays), clamped to [0, totalYield].
 */
export function accruedYieldPaise(totalYieldPaise: number, elapsedDays: number, tenorDays: number): number {
  if (tenorDays <= 0) return totalYieldPaise;
  const e = Math.max(0, Math.min(elapsedDays, tenorDays));
  return mulDivFloor(totalYieldPaise, e, tenorDays);
}
