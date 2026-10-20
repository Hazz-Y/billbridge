/** Fallback extractor: pdf-parse text (or OCR text) + regex heuristics. Integer paise only (parseDecimalToPaise). */
import { GSTIN_REGEX, addDays, parseDecimalToPaise, type LineItem } from '@billbridge/shared';
import { normalizeDate, postprocess, type RawExtraction } from './postprocess.js';
import type { ExtractedInvoice } from '@billbridge/shared';

const GSTIN_G = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const DATE = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})`;
const DUE_RE = new RegExp(String.raw`(?:due\s*date|payment\s*due|due\s*on|due\s*by|pay\s*by)\s*[:.\-]?\s*${DATE}`, 'i');
const INVOICE_DATE_RE = new RegExp(String.raw`(?:invoice\s*date|date\s*of\s*(?:issue|invoice)|dated|issued?\s*on|bill\s*date)\s*[:.\-]?\s*${DATE}`, 'i');
const ANY_DATE_RE = new RegExp(DATE, 'i');
const NET_TERMS_RE = /net\s*(\d{1,3})\s*days?/i;
const INVOICE_NO_LABELED_RE = /(?:invoice\s*(?:no|number|num|#)|inv(?:oice)?\s*(?:#|no|num))\.?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/\-]*\d[A-Z0-9/\-]*)/i;
const INVOICE_NO_BARE_RE = /\bINV[-/ ]?\d[\w/\-]*/i;
const LINE_ITEM_RE = /^\s*(\d{1,2})[.)]?\s+(.+?)\s+(\d{4,8})\s+(\d[\d,]*)\s+(?:Rs\.?\s*|INR\s*)?(\d[\d,]*(?:\.\d{1,2})?)(?:\s*\/-)?\s+(?:Rs\.?\s*|INR\s*)?(\d[\d,]*(?:\.\d{1,2})?)(?:\s*\/-)?\s*$/;
const AMOUNT_TOKEN_RE = /(?:Rs\.?|INR|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(%|\/-)?/g;

/** Last amount token on a line that is not a percentage. */
export function lastAmountPaise(line: string): number | null {
  let last: number | null = null;
  for (const m of line.matchAll(AMOUNT_TOKEN_RE)) {
    if (m[2] === '%') continue;
    const v = parseDecimalToPaise(m[1] ?? '');
    if (v !== null) last = v;
  }
  return last;
}

function cleanLabelLine(s: string): string { return s.replace(/\s+/g, ' ').replace(/[:\-–]\s*$/, '').trim(); }
function isLabelOnly(s: string): boolean { return /^(bill(ed)?\s*to|buyer|customer|ship\s*to|supplier|seller|from|to|tax\s*invoice|invoice|original.*)$/i.test(cleanLabelLine(s)); }

function nameBefore(lines: string[], idx: number): string | null {
  for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
    const l = lines[i] ?? '';
    const c = cleanLabelLine(l);
    if (!c || /GSTIN|PAN\b|\d{6}/i.test(c) || isLabelOnly(c)) continue;
    // "Buyer: Aurora Motors Ltd" -> take the part after the label
    const m = /^(?:bill(?:ed)?\s*to|buyer|customer|supplier|seller|from|to)\s*[:\-]\s*(.+)$/i.exec(c);
    return (m ? m[1] ?? c : c).trim();
  }
  return null;
}

export interface FallbackParse extends RawExtraction { text: string }

export function parseInvoiceText(text: string): FallbackParse {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/ /g, ' ').trimEnd());
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  const warnings: string[] = [];
  const fc: Record<string, number> = {};

  // GSTINs in document order: supplier first, then buyer.
  const gstins: Array<{ value: string; line: number }> = [];
  nonEmpty.forEach((l, i) => { for (const m of l.toUpperCase().matchAll(GSTIN_G)) gstins.push({ value: m[0], line: i }); });
  const seen = new Set<string>();
  const uniq = gstins.filter((g) => (seen.has(g.value) ? false : (seen.add(g.value), true)));
  const supplier = uniq[0] ?? null;
  const buyer = uniq[1] ?? null;
  if (supplier) fc['supplierGstin'] = GSTIN_REGEX.test(supplier.value) ? 90 : 40;
  if (buyer) fc['buyerGstin'] = GSTIN_REGEX.test(buyer.value) ? 90 : 40;
  if (uniq.length > 2) warnings.push(`Found ${uniq.length} GSTINs; using the first two (supplier, buyer)`);
  const supplierName = supplier ? nameBefore(nonEmpty, supplier.line) : null;
  const buyerName = buyer ? nameBefore(nonEmpty, buyer.line) : null;

  // Invoice number
  let invoiceNumber: string | null = null;
  const labeled = INVOICE_NO_LABELED_RE.exec(text);
  if (labeled?.[1]) { invoiceNumber = labeled[1].toUpperCase(); fc['invoiceNumber'] = 92; }
  else {
    const bare = INVOICE_NO_BARE_RE.exec(text);
    if (bare) { invoiceNumber = bare[0].toUpperCase().replace(/\s+/g, '-'); fc['invoiceNumber'] = 80; warnings.push('Invoice number found without a label'); }
  }

  // Dates
  const dueM = DUE_RE.exec(text);
  const invM = INVOICE_DATE_RE.exec(text);
  let invoiceDate = invM ? normalizeDate(invM[1]) : null;
  if (invoiceDate) fc['invoiceDate'] = 90;
  else {
    const dueRaw = dueM?.[1] ?? '';
    for (const l of nonEmpty) {
      const m = ANY_DATE_RE.exec(l);
      if (m && m[1] !== dueRaw) { invoiceDate = normalizeDate(m[1]); if (invoiceDate) { fc['invoiceDate'] = 65; warnings.push('Invoice date taken from an unlabeled date'); break; } }
    }
  }
  let dueDate = dueM ? normalizeDate(dueM[1]) : null;
  if (dueDate) fc['dueDate'] = 90;
  else {
    const net = NET_TERMS_RE.exec(text);
    if (net && invoiceDate) {
      dueDate = addDays(invoiceDate, Number(net[1]));
      fc['dueDate'] = 70;
      warnings.push(`Due date inferred from payment terms (Net ${net[1]} days)`);
    }
  }

  // Line items
  const lineItems: LineItem[] = [];
  let arithmeticOk = true;
  for (const l of nonEmpty) {
    const m = LINE_ITEM_RE.exec(l);
    if (!m) continue;
    const qty = Number((m[4] ?? '0').replace(/,/g, ''));
    const unit = parseDecimalToPaise(m[5] ?? '');
    const total = parseDecimalToPaise(m[6] ?? '');
    if (unit === null || total === null || !Number.isSafeInteger(qty)) continue;
    if (qty * unit !== total) arithmeticOk = false;
    lineItems.push({ description: (m[2] ?? '').replace(/\s+/g, ' ').trim(), quantity: qty, unitPricePaise: unit, totalPaise: total, hsnCode: m[3] ?? '' });
  }
  if (lineItems.length) fc['lineItems'] = arithmeticOk ? 88 : 70;
  if (lineItems.length && !arithmeticOk) warnings.push('Some line items have qty × unit price ≠ amount');

  // Totals and tax
  let totalAmountPaise: number | null = null;
  let taxAmountPaise: number | null = null;
  let taxLines = 0;
  for (const l of nonEmpty) {
    if (/\b(grand\s*total|total\s*(?:amount|payable|due|invoice\s*value)?|amount\s*payable|net\s*payable|invoice\s*total)\b/i.test(l) && !/sub\s*-?\s*total|taxable|before\s*tax/i.test(l)) {
      const v = lastAmountPaise(l.replace(/\b(grand\s*total|total|amount\s*payable|net\s*payable|invoice\s*total|payable|due)\b/gi, ''));
      if (v !== null && v > 0) totalAmountPaise = v; // last wins (grand total usually at the bottom)
    }
    if (/\b(?:[CSI]?GST|tax)\b(?!\s*in)/i.test(l) && !/GSTIN|taxable|total\s*tax(?:able)?\s*value|before\s*tax/i.test(l) && !/\btotal\b/i.test(l)) {
      const v = lastAmountPaise(l.replace(/\b[CSI]?GST\b|\btax\b/gi, ''));
      if (v !== null) { taxAmountPaise = (taxAmountPaise ?? 0) + v; taxLines++; }
    }
  }
  if (totalAmountPaise !== null) fc['totalAmountPaise'] = 90;
  if (taxAmountPaise !== null) fc['taxAmountPaise'] = taxLines > 1 ? 80 : 85;

  return {
    supplierGstin: supplier?.value ?? null, buyerGstin: buyer?.value ?? null, supplierName, buyerName, invoiceNumber, invoiceDate, dueDate,
    lineItems, totalAmountPaise, taxAmountPaise, fieldConfidence: fc, warnings, source: 'FALLBACK', text,
  };
}

export async function pdfText(buffer: Buffer): Promise<string> {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  // pdf.js 1.10 mis-handles Node Buffers (pooled slabs); hand it a plain, freshly copied Uint8Array.
  const r = await pdfParse(new Uint8Array(buffer));
  return r.text;
}

export async function imageText(buffer: Buffer, cachePath: string): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { cachePath });
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally { await worker.terminate(); }
}

export async function extractWithFallback(buffer: Buffer, mime: string, opts: { ocrCachePath: string }): Promise<ExtractedInvoice> {
  const text = mime === 'application/pdf' ? await pdfText(buffer) : await imageText(buffer, opts.ocrCachePath);
  const parsed = parseInvoiceText(text);
  if (mime !== 'application/pdf') parsed.warnings = [...(parsed.warnings ?? []), 'OCR source: confidence reduced'];
  const result = postprocess(parsed);
  if (mime !== 'application/pdf') {
    for (const k of Object.keys(result.fieldConfidence)) result.fieldConfidence[k] = Math.min(result.fieldConfidence[k] ?? 0, 75);
    result.confidence = Math.min(result.confidence, 75);
  }
  return result;
}
