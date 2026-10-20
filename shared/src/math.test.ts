import { describe, expect, it } from 'vitest';
import { computePricing } from './pricing.js';
import { computeBuyerScore } from './score.js';
import { computeWaterfall } from './waterfall.js';
import { formatINR, paiseToDecimalString, parseDecimalToPaise } from './money.js';
import { isValidGstin, makeGstin } from './gstin.js';
import { daysBetween, addDays } from './dates.js';
import { invoiceContentString } from './canonical.js';
import { DEMO_GSTINS, DEMO_INVOICE } from './demo.js';

describe('pricing (spec 4.7 worked example)', () => {
  it('unit 100000, 800 bps, 67 days -> 1468 / 98532 / 811', () => {
    const p = computePricing(100000, 800, 67);
    expect(p.discountPerUnitPaise).toBe(1468);
    expect(p.pricePerUnitPaise).toBe(98532);
    expect(p.annualizedYieldBps).toBe(811);
  });
  it('tenor 1 day minimum, zero discount', () => {
    expect(computePricing(100000, 0, 1).pricePerUnitPaise).toBe(100000);
  });
});

describe('buyer score (spec 4.9)', () => {
  it.each([
    [0, 0, 0, 50], [1, 0, 0, 100], [5, 2, 0, 63], [6, 2, 0, 67], [0, 0, 1, 0], [4, 1, 0, 73], [3, 0, 0, 100], [5, 2, 1, 38],
  ])('%i/%i/%i -> %i', (a, b, c, s) => expect(computeBuyerScore(a, b, c)).toBe(s));
});

describe('waterfall (spec 4.8)', () => {
  it('demo case: 400 units, A 250 / B 150, face 40,000,000', () => {
    const w = computeWaterfall(40_000_000, 400, 400, [{ holderId: 'investorB', units: 150 }, { holderId: 'investorA', units: 250 }]);
    expect(w.shares.map((s) => [s.holderId, s.sharePaise])).toEqual([['investorA', 25_000_000], ['investorB', 15_000_000]]);
    expect(w.residualPaise).toBe(0);
  });
  it('single holder gets everything', () => {
    const w = computeWaterfall(1_000_000, 10, 10, [{ holderId: 'x', units: 10 }]);
    expect(w.shares[0]?.sharePaise).toBe(1_000_000);
  });
  it('7 holders with remainder: last holder (sorted) absorbs it, total exact', () => {
    const holders = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'].map((h) => ({ holderId: h, units: 1 }));
    const w = computeWaterfall(1_000_003, 7, 7, holders);
    const sum = w.shares.reduce((s, x) => s + x.sharePaise, 0);
    expect(sum + w.residualPaise).toBe(1_000_003);
    expect(w.shares.slice(0, 6).every((s) => s.sharePaise === 142857)).toBe(true);
    expect(w.shares[6]?.holderId).toBe('h7');
    expect(w.shares[6]?.sharePaise).toBe(1_000_003 - 142857 * 6);
  });
  it('partially funded: residual to supplier', () => {
    const w = computeWaterfall(1_000_000, 4, 10, [{ holderId: 'a', units: 3 }, { holderId: 'b', units: 1 }]);
    expect(w.investorPoolPaise).toBe(400_000);
    expect(w.residualPaise).toBe(600_000);
    expect(w.shares.map((s) => s.sharePaise)).toEqual([300_000, 100_000]);
  });
  it('invariant holds for odd amounts and unit mixes', () => {
    for (let amt = 999_990; amt < 1_000_010; amt++) {
      const w = computeWaterfall(amt, 9, 10, [{ holderId: 'a', units: 4 }, { holderId: 'b', units: 3 }, { holderId: 'c', units: 2 }]);
      expect(w.shares.reduce((s, x) => s + x.sharePaise, 0) + w.residualPaise).toBe(amt);
    }
  });
});

describe('money', () => {
  it('paise -> decimal string', () => {
    expect(paiseToDecimalString(9853200)).toBe('98532.00');
    expect(paiseToDecimalString(5)).toBe('0.05');
  });
  it('decimal string -> paise (no floats)', () => {
    expect(parseDecimalToPaise('4,00,000.00')).toBe(40_000_000);
    expect(parseDecimalToPaise('₹ 985.32')).toBe(98532);
    expect(parseDecimalToPaise('0.1')).toBe(10);
    expect(parseDecimalToPaise('abc')).toBeNull();
    expect(parseDecimalToPaise('-5')).toBeNull();
  });
  it('formats in en-IN', () => {
    expect(formatINR(40_000_000)).toBe('₹4,00,000');
    expect(formatINR(98532)).toBe('₹985.32');
  });
});

describe('gstin', () => {
  it('generated demo GSTINs are valid', () => {
    for (const g of Object.values(DEMO_GSTINS)) expect(isValidGstin(g)).toBe(true);
  });
  it('rejects a wrong check digit', () => {
    const g = makeGstin('27AAACS1234A1Z');
    const bad = g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A');
    expect(isValidGstin(bad)).toBe(false);
  });
});

describe('dates & canonical', () => {
  it('days between date parts', () => {
    expect(daysBetween('2026-03-01T10:00:00Z', '2026-05-07')).toBe(67);
    expect(addDays('2026-05-07', 7)).toBe('2026-05-14');
  });
  it('content string excludes invoice number and normalizes items', () => {
    const a = invoiceContentString('x', 'y', '2026-02-25', 100, [{ description: '  B item ', quantity: 1, unitPricePaise: 1, totalPaise: 1 }, { description: 'a', quantity: 2, unitPricePaise: 1, totalPaise: 2 }]);
    expect(a).toBe('X|Y|2026-02-25|100|a~2~1~2;b item~1~1~1');
  });
  it('demo invoice line items + tax == face', () => {
    const sum = DEMO_INVOICE.lineItems.reduce((s, li) => s + li.totalPaise, 0) + DEMO_INVOICE.taxAmountPaise;
    expect(sum).toBe(DEMO_INVOICE.faceValuePaise);
  });
});
