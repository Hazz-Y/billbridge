import { describe, expect, it } from 'vitest';
import { DEMO_GSTINS, parseDecimalToPaise } from '@billbridge/shared';
import { normalizeDate, postprocess } from '../src/ai/postprocess.js';
import { lastAmountPaise, parseInvoiceText } from '../src/ai/fallback.js';

const base = {
  supplierGstin: DEMO_GSTINS.msme1, buyerGstin: DEMO_GSTINS.buyer1, invoiceNumber: 'INV-2025-001', invoiceDate: '2026-10-13', dueDate: '2026-12-26',
  lineItems: [{ description: 'A', quantity: 2, unitPricePaise: 100, totalPaise: 200 }], totalAmountPaise: 236, taxAmountPaise: 36, source: 'FALLBACK' as const,
};

describe('postprocess', () => {
  it('passes a consistent extraction with high confidence', () => {
    const r = postprocess(base);
    expect(r.warnings).toEqual([]);
    expect(r.confidence).toBeGreaterThanOrEqual(80);
    expect(r.fieldConfidence['supplierGstin']).toBeGreaterThanOrEqual(85);
  });
  it('caps a bad GSTIN at 30 with a warning', () => {
    const r = postprocess({ ...base, buyerGstin: '27AABCA3456D1Z9' });
    expect(r.fieldConfidence['buyerGstin']).toBeLessThanOrEqual(30);
    expect(r.warnings.some((w) => /checksum/.test(w))).toBe(true);
  });
  it('caps total at 50 on arithmetic mismatch', () => {
    const r = postprocess({ ...base, totalAmountPaise: 300 });
    expect(r.fieldConfidence['totalAmountPaise']).toBeLessThanOrEqual(50);
    expect(r.warnings.some((w) => /Arithmetic mismatch/.test(w))).toBe(true);
  });
  it('warns when due date is not after invoice date', () => {
    const r = postprocess({ ...base, dueDate: '2026-10-13' });
    expect(r.warnings.some((w) => /not after/.test(w))).toBe(true);
  });
  it('gives 0 to missing fields and lowers the overall score', () => {
    const r = postprocess({ ...base, invoiceNumber: '', dueDate: null });
    expect(r.fieldConfidence['invoiceNumber']).toBe(0);
    expect(r.fieldConfidence['dueDate']).toBe(0);
    expect(r.confidence).toBeLessThan(postprocess(base).confidence);
  });
  it('normalizes date formats', () => {
    expect(normalizeDate('13/10/2026')).toBe('2026-10-13');
    expect(normalizeDate('2026-10-13')).toBe('2026-10-13');
    expect(normalizeDate('7 May 2026')).toBe('2026-05-07');
    expect(normalizeDate('May 7, 2026')).toBe('2026-05-07');
    expect(normalizeDate('31/02/2026')).toBeNull();
  });
});

describe('paise parsing (never floats)', () => {
  it('parses Indian grouping and prefixes', () => {
    expect(parseDecimalToPaise('4,00,000.00')).toBe(40000000);
    expect(parseDecimalToPaise('Rs. 4,00,000')).toBe(40000000);
    expect(parseDecimalToPaise('0.1')).toBe(10);
    expect(parseDecimalToPaise('1234.5')).toBe(123450);
  });
  it('takes the last non-percentage amount on a line', () => {
    expect(lastAmountPaise('GST 18%: Rs. 61,017.00')).toBe(6101700);
    expect(lastAmountPaise('CGST @9%  Rs. 30,508.50')).toBe(3050850);
    expect(lastAmountPaise('Grand Total  Rs. 4,00,000.00/-')).toBe(40000000);
  });
  it('parses line item rows from text', () => {
    const p = parseInvoiceText('1  CNC housings  76169990    400       520.00    2,08,000.00\nTOTAL: Rs. 2,45,440.00\nGST 18%: 37,440.00');
    expect(p.lineItems?.[0]).toMatchObject({ quantity: 400, unitPricePaise: 52000, totalPaise: 20800000, hsnCode: '76169990' });
    expect(p.totalAmountPaise).toBe(24544000);
    expect(p.taxAmountPaise).toBe(3744000);
  });
});
