/** Gemini extraction (only when GEMINI_API_KEY is set). Inline document + JSON response schema, hard timeout. */
import { parseDecimalToPaise, type ExtractedInvoice } from '@billbridge/shared';
import { postprocess, type RawExtraction } from './postprocess.js';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    supplierGstin: { type: 'string' }, buyerGstin: { type: 'string' }, supplierName: { type: 'string' }, buyerName: { type: 'string' },
    invoiceNumber: { type: 'string' }, invoiceDate: { type: 'string', description: 'YYYY-MM-DD' }, dueDate: { type: 'string', description: 'YYYY-MM-DD or empty' },
    paymentTermsDays: { type: 'integer' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, hsnCode: { type: 'string' }, quantity: { type: 'integer' }, unitPrice: { type: 'string', description: 'decimal rupees as string' }, amount: { type: 'string', description: 'decimal rupees as string' } },
        required: ['description', 'quantity', 'unitPrice', 'amount'],
      },
    },
    taxAmount: { type: 'string', description: 'total GST in rupees as decimal string' },
    totalAmount: { type: 'string', description: 'grand total in rupees as decimal string' },
    fieldConfidence: {
      type: 'object',
      properties: { supplierGstin: { type: 'integer' }, buyerGstin: { type: 'integer' }, invoiceNumber: { type: 'integer' }, invoiceDate: { type: 'integer' }, dueDate: { type: 'integer' }, totalAmountPaise: { type: 'integer' }, lineItems: { type: 'integer' }, taxAmountPaise: { type: 'integer' } },
    },
  },
  required: ['supplierGstin', 'buyerGstin', 'invoiceNumber', 'invoiceDate', 'lineItems', 'totalAmount'],
};

const PROMPT = 'Extract the fields of this Indian GST tax invoice. Supplier = the party issuing the invoice; buyer = the party billed. ' +
  'Return money as decimal rupee strings exactly as printed (no currency symbols), dates as YYYY-MM-DD, and per-field confidence 0-100. ' +
  'If no due date is printed but payment terms like "Net 30 days" exist, leave dueDate empty and set paymentTermsDays.';

interface GeminiOut {
  supplierGstin?: string; buyerGstin?: string; supplierName?: string; buyerName?: string; invoiceNumber?: string; invoiceDate?: string; dueDate?: string;
  paymentTermsDays?: number; lineItems?: Array<{ description: string; hsnCode?: string; quantity: number; unitPrice: string; amount: string }>;
  taxAmount?: string; totalAmount?: string; fieldConfidence?: Record<string, number>;
}

export async function extractWithGemini(buffer: Buffer, mime: string, opts: { apiKey: string; model: string; timeoutMs: number }): Promise<ExtractedInvoice> {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await ai.models.generateContent({
      model: opts.model,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: buffer.toString('base64') } }, { text: PROMPT }] }],
      config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, abortSignal: ctrl.signal, temperature: 0 },
    });
    const text = res.text ?? '';
    const out = JSON.parse(text) as GeminiOut;
    const warnings: string[] = [];
    const lineItems = (out.lineItems ?? []).map((li) => ({
      description: li.description, quantity: li.quantity, unitPricePaise: parseDecimalToPaise(li.unitPrice ?? '') ?? 0, totalPaise: parseDecimalToPaise(li.amount ?? '') ?? 0,
      ...(li.hsnCode ? { hsnCode: li.hsnCode } : {}),
    }));
    let dueDate = out.dueDate ?? '';
    const fc: Record<string, number> = { ...(out.fieldConfidence ?? {}) };
    if (!dueDate && out.paymentTermsDays && out.invoiceDate) {
      const { addDays } = await import('@billbridge/shared');
      dueDate = addDays(out.invoiceDate, out.paymentTermsDays);
      fc['dueDate'] = Math.min(fc['dueDate'] ?? 70, 70);
      warnings.push(`Due date inferred from payment terms (Net ${out.paymentTermsDays} days)`);
    }
    const raw: RawExtraction = {
      supplierGstin: out.supplierGstin, buyerGstin: out.buyerGstin, supplierName: out.supplierName, buyerName: out.buyerName, invoiceNumber: out.invoiceNumber,
      invoiceDate: out.invoiceDate, dueDate, lineItems, totalAmountPaise: parseDecimalToPaise(out.totalAmount ?? '') ?? 0, taxAmountPaise: parseDecimalToPaise(out.taxAmount ?? '') ?? 0,
      fieldConfidence: fc, warnings, source: 'GEMINI',
    };
    return postprocess(raw);
  } finally { clearTimeout(timer); }
}
