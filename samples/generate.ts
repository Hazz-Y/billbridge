/**
 * Generates the synthetic sample invoices (pdfkit). Run: `npm run samples --workspace backend`.
 * Dates are computed at generation time (invoice date = today - 7 days, due = today + 67 days) and printed.
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_GSTINS, DEMO_INVOICE, addDays, formatINR, paiseToDecimalString } from '@billbridge/shared';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)));
const today = new Date().toISOString().slice(0, 10);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "4,00,000.00" (Indian grouping, no currency sign — pdfkit standard fonts have no rupee glyph). */
const dec = (paise: number) => { const s = paiseToDecimalString(paise); const [w, f] = s.split('.'); return `${group(w ?? '0')}.${f ?? '00'}`; };
function group(w: string): string {
  if (w.length <= 3) return w;
  const last3 = w.slice(-3); let rest = w.slice(0, -3); const parts: string[] = [];
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
  if (rest) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

interface Item { description: string; quantity: number; unitPricePaise: number; totalPaise: number; hsnCode: string }
interface InvoiceSpec {
  file: string; supplierName: string; supplierGstin: string; supplierAddr: string; buyerName: string; buyerGstin: string; buyerAddr: string;
  number: string; issueDate: string; dueDate: string; items: Item[]; subtotalPaise: number; taxPaise: number; totalPaise: number; vpa: string;
}

const aurora: InvoiceSpec = {
  file: 'invoice-aurora-001.pdf',
  supplierName: 'Sharma Precision Components Pvt Ltd', supplierGstin: DEMO_GSTINS.msme1, supplierAddr: 'Plot 14, MIDC Industrial Area, Bhosari, Pune 411026, Maharashtra',
  buyerName: 'Aurora Motors Ltd', buyerGstin: DEMO_GSTINS.buyer1, buyerAddr: 'Chakan Plant, Gate 3, Pune 410501, Maharashtra',
  number: DEMO_INVOICE.invoiceNumber, issueDate: addDays(today, -7), dueDate: addDays(today, DEMO_INVOICE.tenorDaysFromToday),
  items: DEMO_INVOICE.lineItems.map((li) => ({ ...li })),
  subtotalPaise: 33_898_300, taxPaise: DEMO_INVOICE.taxAmountPaise, totalPaise: DEMO_INVOICE.faceValuePaise, vpa: 'sharmaprecision@upi',
};
const kaveri: InvoiceSpec = {
  file: 'invoice-kaveri-002.pdf',
  supplierName: 'Kaveri Textiles', supplierGstin: DEMO_GSTINS.msme2, supplierAddr: '21 Mill Road, Tiruppur 641604, Tamil Nadu',
  buyerName: 'Meridian Retail Pvt Ltd', buyerGstin: DEMO_GSTINS.buyer2, buyerAddr: 'Warehouse 7, Peenya Industrial Area, Bengaluru 560058, Karnataka',
  number: 'INV-2025-002', issueDate: addDays(today, -3), dueDate: addDays(today, 45),
  items: [
    { description: 'Combed cotton fabric 40s, 58in width', quantity: 2000, unitPricePaise: 8_500, totalPaise: 17_000_000, hsnCode: '52081190' },
    { description: 'Dyed yarn lot 12 (assorted)', quantity: 1, unitPricePaise: 4_186_441, totalPaise: 4_186_441, hsnCode: '52052200' },
  ],
  subtotalPaise: 21_186_441, taxPaise: 3_813_559, totalPaise: 25_000_000, vpa: 'kaveritextiles@upi',
};

function check(s: InvoiceSpec) {
  const sum = s.items.reduce((a, i) => a + i.totalPaise, 0);
  if (sum !== s.subtotalPaise) throw new Error(`${s.file}: items ${sum} != subtotal ${s.subtotalPaise}`);
  if (s.subtotalPaise + s.taxPaise !== s.totalPaise) throw new Error(`${s.file}: subtotal + tax != total`);
  for (const i of s.items) if (i.quantity * i.unitPricePaise !== i.totalPaise) throw new Error(`${s.file}: ${i.description} qty*unit != total`);
}

function padR(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s: string, n: number) { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function row(cols: [string, number, 'L' | 'R'][]): string { return cols.map(([s, n, a]) => (a === 'L' ? padR(s, n) : padL(s, n))).join(' '); }

function footer(doc: PDFKit.PDFDocument) {
  doc.moveDown(2).font('Helvetica-Oblique').fontSize(8).fillColor('#666')
    .text('SANDBOX - synthetic invoice for demo purposes only. Not a real tax document. BillBridge prototype.', { align: 'center' });
}

async function writeClean(s: InvoiceSpec): Promise<void> {
  check(s);
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${s.number} ${s.supplierName}` } });
  const out = createWriteStream(resolve(OUT, s.file));
  doc.pipe(out);
  doc.font('Helvetica-Bold').fontSize(18).text('TAX INVOICE', { align: 'right' });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(13).text(s.supplierName);
  doc.font('Helvetica').fontSize(10).text(`GSTIN: ${s.supplierGstin}`);
  doc.text(s.supplierAddr);
  doc.moveDown();
  doc.text(`Invoice No: ${s.number}`);
  doc.text(`Invoice Date: ${ddmmyyyy(s.issueDate)}`);
  doc.text(`Due Date: ${ddmmyyyy(s.dueDate)}`);
  doc.moveDown();
  doc.font('Helvetica-Bold').text('Bill To:');
  doc.font('Helvetica').text(s.buyerName);
  doc.text(`GSTIN: ${s.buyerGstin}`);
  doc.text(s.buyerAddr);
  doc.moveDown();
  doc.font('Courier-Bold').fontSize(9);
  doc.text(row([['#', 2, 'L'], ['Description', 44, 'L'], ['HSN', 8, 'L'], ['Qty', 6, 'R'], ['Unit Price', 12, 'R'], ['Amount', 14, 'R']]));
  doc.font('Courier');
  s.items.forEach((it, i) => {
    doc.text(row([[String(i + 1), 2, 'L'], [it.description, 44, 'L'], [it.hsnCode, 8, 'L'], [String(it.quantity), 6, 'R'], [dec(it.unitPricePaise), 12, 'R'], [dec(it.totalPaise), 14, 'R']]));
  });
  doc.moveDown();
  doc.font('Helvetica').fontSize(10);
  doc.text(`Subtotal: Rs. ${dec(s.subtotalPaise)}`, { align: 'right' });
  doc.text(`GST 18%: Rs. ${dec(s.taxPaise)}`, { align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).text(`TOTAL: Rs. ${dec(s.totalPaise)}`, { align: 'right' });
  doc.moveDown();
  doc.font('Helvetica').fontSize(10).text(`Pay via UPI: ${s.vpa}`);
  doc.text('Goods once sold will not be taken back. Subject to Pune jurisdiction.');
  footer(doc);
  doc.end();
  await new Promise<void>((res, rej) => { out.on('finish', () => res()); out.on('error', rej); });
}

async function writeScanLike(s: InvoiceSpec, file: string): Promise<void> {
  check(s);
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `${s.number} (scan)` } });
  const out = createWriteStream(resolve(OUT, file));
  doc.pipe(out);
  // slightly rotated header, like a skewed scan
  doc.save().rotate(-2, { origin: [60, 60] }).font('Times-Bold').fontSize(16).fillColor('#222').text(s.supplierName.toUpperCase(), 60, 50).restore();
  doc.font('Times-Roman').fontSize(10).fillColor('#333');
  doc.text(`GSTIN No. ${s.supplierGstin}`, 60, 80);
  doc.text(s.supplierAddr);
  doc.moveDown();
  doc.font('Times-Italic').text('Tax Invoice  (Original for Recipient)');
  doc.font('Times-Roman');
  doc.text(`Inv #: ${s.number}      Dated: ${longDate(s.issueDate)}`);
  doc.text('Payment terms: Net 67 days from invoice date');
  doc.moveDown();
  doc.text('Buyer');
  doc.text(s.buyerName);
  doc.text(`GSTIN No. ${s.buyerGstin}`);
  doc.text(s.buyerAddr);
  doc.moveDown();
  doc.font('Courier').fontSize(8.5);
  doc.text(row([['Sr', 2, 'L'], ['Particulars', 46, 'L'], ['HSN', 8, 'L'], ['Qty', 6, 'R'], ['Rate', 12, 'R'], ['Amount', 14, 'R']]));
  doc.text('-'.repeat(92));
  s.items.forEach((it, i) => {
    const unit = paiseToDecimalString(it.unitPricePaise);
    const amt = i % 2 === 0 ? paiseToDecimalString(it.totalPaise) : dec(it.totalPaise);
    doc.text(row([[`${i + 1}.`, 2, 'L'], [it.description, 46, 'L'], [it.hsnCode, 8, 'L'], [String(it.quantity), 6, 'R'], [unit, 12, 'R'], [amt, 14, 'R']]));
  });
  doc.text('-'.repeat(92));
  doc.moveDown();
  doc.font('Times-Roman').fontSize(10);
  const half = s.taxPaise / 2;
  doc.text(`Taxable value  Rs. ${dec(s.subtotalPaise)}/-`, { align: 'right' });
  if (Number.isInteger(half)) {
    doc.text(`CGST @9%  Rs. ${dec(half)}`, { align: 'right' });
    doc.text(`SGST @9%  Rs. ${dec(half)}`, { align: 'right' });
  } else doc.text(`IGST @18%  Rs. ${dec(s.taxPaise)}`, { align: 'right' });
  doc.font('Times-Bold').fontSize(11).text(`Grand Total  Rs. ${dec(s.totalPaise)}/-`, { align: 'right' });
  doc.font('Times-Roman').fontSize(9).moveDown();
  doc.text('Amount in words: Rupees Four Lakh only.');
  doc.text(`E. & O.E.   Remit to UPI ${s.vpa}`);
  doc.text('For ' + s.supplierName);
  doc.moveDown(2);
  doc.text('Authorised Signatory');
  footer(doc);
  doc.end();
  await new Promise<void>((res, rej) => { out.on('finish', () => res()); out.on('error', rej); });
}

await writeClean(aurora);
await writeScanLike(aurora, 'invoice-aurora-001-scan-like.pdf');
await writeClean(kaveri);
console.log(`generated in ${OUT}`);
console.log(`  invoice-aurora-001.pdf            ${aurora.number}  issue ${aurora.issueDate}  due ${aurora.dueDate}  total ${formatINR(aurora.totalPaise)}`);
console.log(`  invoice-aurora-001-scan-like.pdf  ${aurora.number}  issue ${aurora.issueDate}  due (Net 67) ${aurora.dueDate}`);
console.log(`  invoice-kaveri-002.pdf            ${kaveri.number}  issue ${kaveri.issueDate}  due ${kaveri.dueDate}  total ${formatINR(kaveri.totalPaise)}`);
