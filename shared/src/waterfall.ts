import { mulDivFloor } from './money.js';

/**
 * Settlement waterfall (spec 4.8). Deterministic, integer only.
 *
 * investorPool = floor(amount * unitsSold / totalUnits)
 * residual     = amount - investorPool                         (-> supplier, 0 when fully funded)
 * holders sorted by holderId ascending
 * each holder except last: share = floor(investorPool * units / unitsSold)
 * last holder:             share = investorPool - sum(previous)   (remainder, exact total)
 *
 * Invariant: sum(shares) + residual == amount.
 */
export interface WaterfallHolder { holderId: string; units: number }
export interface WaterfallShare { holderId: string; units: number; sharePaise: number; index: number }
export interface WaterfallResult { investorPoolPaise: number; residualPaise: number; shares: WaterfallShare[] }

export function computeWaterfall(amountPaise: number, unitsSold: number, totalUnits: number, holders: WaterfallHolder[]): WaterfallResult {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new Error('amountPaise must be a non-negative integer');
  if (!Number.isSafeInteger(totalUnits) || totalUnits <= 0) throw new Error('totalUnits must be positive');
  if (!Number.isSafeInteger(unitsSold) || unitsSold < 0 || unitsSold > totalUnits) throw new Error('unitsSold out of range');
  const sorted = [...holders].sort((a, b) => (a.holderId < b.holderId ? -1 : a.holderId > b.holderId ? 1 : 0));
  const sumUnits = sorted.reduce((s, h) => s + h.units, 0);
  if (sumUnits !== unitsSold) throw new Error(`holder units (${sumUnits}) != unitsSold (${unitsSold})`);

  const investorPoolPaise = mulDivFloor(amountPaise, unitsSold, totalUnits);
  const residualPaise = amountPaise - investorPoolPaise;
  const shares: WaterfallShare[] = [];
  let distributed = 0;
  sorted.forEach((h, i) => {
    const isLast = i === sorted.length - 1;
    const share = isLast ? investorPoolPaise - distributed : mulDivFloor(investorPoolPaise, h.units, unitsSold);
    distributed += share;
    shares.push({ holderId: h.holderId, units: h.units, sharePaise: share, index: i });
  });
  const total = shares.reduce((s, x) => s + x.sharePaise, 0) + residualPaise;
  if (total !== amountPaise) throw new Error(`waterfall invariant violated: ${total} != ${amountPaise}`);
  return { investorPoolPaise, residualPaise, shares };
}
