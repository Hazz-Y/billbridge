/**
 * Deterministic post-processing applied to BOTH extraction paths (Gemini and fallback).
 * Validates GSTINs (regex + checksum), arithmetic (Σ line items + tax == total), date ordering,
 * normalises dates to YYYY-MM-DD and computes the weighted overall confidence.
 */
import { isIsoDate, isValidGstin, type ExtractedInvoice, type LineItem } from '@billbridge/shared';

export const FIELD_WEIGHTS: Record<string, number> = {
  supplierGstin: 15, buyerGstin: 15, invoiceNumber: 15, invoiceDate: 10, dueDate: 10, totalAmountPaise: 20, lineItems: 10, taxAmountPaise: 5,
};

export interface RawExtraction {
  supplierGstin?: string | null;
  buyerGstin?: string | null;
  supplierName?: string | null;
  buyerName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  lineItems?: LineItem[] | null;
  totalAmountPaise?: number | null;
  taxAmountPaise?: number | null;
  fieldConfidence?: Record<string, number | undefined>;
  warnings?: string[];
  source: 'GEMINI' | 'FALLBACK';
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Accepts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, "7 May 2026", "May 7, 2026", "7th October 2026". Returns YYYY-MM-DD or null. */
export function normalizeDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return check(`${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return check(`${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s);
  if (m) { const mo = MONTHS[(m[2] ?? '').toLowerCase()]; if (mo) return check(`${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`); }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s);
  if (m) { const mo = MONTHS[(m[1] ?? '').toLowerCase()]; if (mo) return check(`${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`); }
  return null;
}
function check(iso: string): string | null { return isIsoDate(iso) ? iso : null; }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function postprocess(raw: RawExtraction): ExtractedInvoice {
  const warnings = [...(raw.warnings ?? [])];
  const fc: Record<string, number> = {};
  const given = raw.fieldConfidence ?? {};
  const conf = (k: string, def: number) => clamp(given[k] ?? def);

  // GSTINs
  const supplierGstin = (raw.supplierGstin ?? '').trim().toUpperCase();
  const buyerGstin = (raw.buyerGstin ?? '').trim().toUpperCase();
  for (const [key, val, label] of [['supplierGstin', supplierGstin, 'Supplier'], ['buyerGstin', buyerGstin, 'Buyer']] as const) {
    if (!val) { fc[key] = 0; warnings.push(`${label} GSTIN not found`); continue; }
    fc[key] = conf(key, 85);
    if (!isValidGstin(val)) { fc[key] = Math.min(fc[key], 30); warnings.push(`${label} GSTIN ${val} failed format/checksum validation`); }
  }

  // Invoice number
  const invoiceNumber = (raw.invoiceNumber ?? '').trim();
  fc['invoiceNumber'] = invoiceNumber ? conf('invoiceNumber', 85) : 0;
  if (!invoiceNumber) warnings.push('Invoice number not found');

  // Dates
  const invoiceDate = normalizeDate(raw.invoiceDate);
  const dueDate = normalizeDate(raw.dueDate);
  fc['invoiceDate'] = invoiceDate ? conf('invoiceDate', 85) : 0;
  fc['dueDate'] = dueDate ? conf('dueDate', 85) : 0;
  if (!invoiceDate) warnings.push(raw.invoiceDate ? `Invoice date "${raw.invoiceDate}" could not be parsed` : 'Invoice date not found');
  if (!dueDate) warnings.push(raw.dueDate ? `Due date "${raw.dueDate}" could not be parsed` : 'Due date not found');
  if (invoiceDate && dueDate && dueDate <= invoiceDate) {
    warnings.push(`Due date ${dueDate} is not after invoice date ${invoiceDate}`);
    fc['dueDate'] = Math.min(fc['dueDate'] ?? 0, 50);
  }

  // Line items + amounts
  const lineItems: LineItem[] = (raw.lineItems ?? []).filter((li) => li && typeof li.description === 'string' && li.description.trim() !== '')
    .map((li) => ({
      description: li.description.trim(), quantity: Math.max(0, Math.trunc(Number(li.quantity) || 0)),
      unitPricePaise: Math.max(0, Math.trunc(Number(li.unitPricePaise) || 0)), totalPaise: Math.max(0, Math.trunc(Number(li.totalPaise) || 0)),
      ...(li.hsnCode ? { hsnCode: String(li.hsnCode) } : {}),
    }));
  fc['lineItems'] = lineItems.length ? conf('lineItems', 80) : 0;
  if (!lineItems.length) warnings.push('No line items extracted');

  const totalAmountPaise = Number.isSafeInteger(raw.totalAmountPaise) && (raw.totalAmountPaise ?? 0) > 0 ? (raw.totalAmountPaise as number) : 0;
  const taxAmountPaise = Number.isSafeInteger(raw.taxAmountPaise) && (raw.taxAmountPaise ?? 0) >= 0 ? (raw.taxAmountPaise as number) : 0;
  fc['totalAmountPaise'] = totalAmountPaise > 0 ? conf('totalAmountPaise', 85) : 0;
  fc['taxAmountPaise'] = raw.taxAmountPaise !== undefined && raw.taxAmountPaise !== null ? conf('taxAmountPaise', 80) : 0;
  if (totalAmountPaise === 0) warnings.push('Total amount not found');
  if (lineItems.length && totalAmountPaise > 0) {
    const sum = lineItems.reduce((s, li) => s + li.totalPaise, 0) + taxAmountPaise;
    if (sum !== totalAmountPaise) {
      warnings.push(`Arithmetic mismatch: line items (${lineItems.reduce((s, li) => s + li.totalPaise, 0)}) + tax (${taxAmountPaise}) = ${sum} paise, but total is ${totalAmountPaise} paise`);
      fc['totalAmountPaise'] = Math.min(fc['totalAmountPaise'] ?? 0, 50);
    }
  }

  // weighted overall
  let wsum = 0; let total = 0;
  for (const [k, w] of Object.entries(FIELD_WEIGHTS)) { wsum += w; total += w * (fc[k] ?? 0); }
  const confidence = clamp(total / wsum);

  return {
    supplierGstin, buyerGstin,
    ...(raw.supplierName ? { supplierName: raw.supplierName.trim() } : {}),
    ...(raw.buyerName ? { buyerName: raw.buyerName.trim() } : {}),
    invoiceNumber, invoiceDate: invoiceDate ?? '', dueDate: dueDate ?? '', lineItems, totalAmountPaise, taxAmountPaise,
    confidence, fieldConfidence: fc, warnings: [...new Set(warnings)], source: raw.source,
  };
}
