import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_GSTINS, DEMO_INVOICE } from '@billbridge/shared';
import { extractWithFallback } from '../src/ai/fallback.js';
import { REPO_ROOT } from '../src/config.js';

const sample = (f: string) => readFileSync(resolve(REPO_ROOT, 'samples', f));
const opts = { ocrCachePath: resolve(REPO_ROOT, '.cache', 'tesseract') };

describe('fallback extractor on sample PDFs', () => {
  it('extracts the clean invoice with every field >= 85', async () => {
    const r = await extractWithFallback(sample('invoice-aurora-001.pdf'), 'application/pdf', opts);
    expect(r.source).toBe('FALLBACK');
    expect(r.supplierGstin).toBe(DEMO_GSTINS.msme1);
    expect(r.buyerGstin).toBe(DEMO_GSTINS.buyer1);
    expect(r.invoiceNumber).toBe('INV-2025-001');
    expect(r.totalAmountPaise).toBe(DEMO_INVOICE.faceValuePaise);
    expect(r.taxAmountPaise).toBe(DEMO_INVOICE.taxAmountPaise);
    expect(r.lineItems).toHaveLength(3);
    expect(r.lineItems.map((l) => l.totalPaise)).toEqual(DEMO_INVOICE.lineItems.map((l) => l.totalPaise));
    expect(r.supplierName).toMatch(/Sharma Precision/);
    expect(r.buyerName).toMatch(/Aurora Motors/);
    expect(r.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.dueDate > r.invoiceDate).toBe(true);
    for (const [k, v] of Object.entries(r.fieldConfidence)) expect(v, k).toBeGreaterThanOrEqual(85);
    expect(r.confidence).toBeGreaterThanOrEqual(85);
    expect(r.warnings).toEqual([]);
  });

  it('extracts the scan-like invoice with an amber (60-84) inferred due date', async () => {
    const r = await extractWithFallback(sample('invoice-aurora-001-scan-like.pdf'), 'application/pdf', opts);
    expect(r.supplierGstin).toBe(DEMO_GSTINS.msme1);
    expect(r.buyerGstin).toBe(DEMO_GSTINS.buyer1);
    expect(r.invoiceNumber).toBe('INV-2025-001');
    expect(r.totalAmountPaise).toBe(DEMO_INVOICE.faceValuePaise);
    expect(r.taxAmountPaise).toBe(DEMO_INVOICE.taxAmountPaise);
    expect(r.lineItems).toHaveLength(3);
    const due = r.fieldConfidence['dueDate'] ?? 0;
    expect(due).toBeGreaterThanOrEqual(60);
    expect(due).toBeLessThanOrEqual(84);
    expect(r.warnings.some((w) => /Due date inferred from payment terms/.test(w))).toBe(true);
    expect(r.dueDate).toBeTruthy();
  });

  it('extracts the Kaveri invoice', async () => {
    const r = await extractWithFallback(sample('invoice-kaveri-002.pdf'), 'application/pdf', opts);
    expect(r.supplierGstin).toBe(DEMO_GSTINS.msme2);
    expect(r.buyerGstin).toBe(DEMO_GSTINS.buyer2);
    expect(r.invoiceNumber).toBe('INV-2025-002');
    expect(r.totalAmountPaise).toBe(25_000_000);
    expect(r.confidence).toBeGreaterThanOrEqual(85);
  });
});
