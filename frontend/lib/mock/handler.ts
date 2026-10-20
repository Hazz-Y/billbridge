import { DEMO_PASSWORD, DEMO_USER_BY_ROLE, type InvoiceStatus, type Role, type TokenResponse, type UserProfile } from '@billbridge/shared';
import {
  ANOMALIES, DEMO_STATE, EVENTS, INVOICES, NETWORK, NOW, PARTICIPANTS, PORTFOLIO, RECONCILIATION, STATS, fakeHash,
  holdingsFor, paymentsFor, privateDetailsFor, profileFor, profileForEmail, scoreFor,
} from './fixtures';

/**
 * Tiny in-memory router used when NEXT_PUBLIC_MOCK_API=true. It serves typed fixtures that satisfy the shared Zod
 * schemas so every screen renders without the backend. State mutations are minimal (status transitions on accept/list).
 */
let current: UserProfile = profileFor('MSME');
let txCounter = 100;
const invoices = INVOICES.map((i) => ({ ...i }));

function tx() {
  txCounter += 1;
  return { txId: fakeHash(`mock-tx-${txCounter}`), blockNumber: txCounter, timestamp: new Date().toISOString() };
}

function token(user: UserProfile): TokenResponse {
  current = user;
  return { accessToken: `mock.${user.role}.${Date.now()}`, refreshToken: 'mock-refresh', user };
}

function fail(code: string, message: string, status: number, details: Record<string, unknown> = {}): never {
  const err = new Error(message) as Error & { mock: true; code: string; status: number; details: Record<string, unknown> };
  err.mock = true; err.code = code; err.status = status; err.details = details;
  throw err;
}

function setStatus(id: string, status: InvoiceStatus, patch: Partial<(typeof invoices)[number]> = {}) {
  const inv = invoices.find((i) => i.invoiceId === id);
  if (!inv) fail('ERR_NOT_FOUND', 'invoice not found', 404);
  Object.assign(inv, patch, { status, updatedAt: new Date().toISOString() });
  return inv;
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function delay<T>(v: T, ms = 250): Promise<T> {
  return new Promise((r) => setTimeout(() => r(v), ms));
}

export async function mockRequest(method: string, fullUrl: string, body: unknown): Promise<unknown> {
  const url = new URL(fullUrl);
  const p = url.pathname;
  const q = url.searchParams;
  const b = asRecord(body);
  const seg = p.split('/').filter(Boolean); // ['api','invoices',':id','accept']

  if (p === '/health') return delay({ ok: true, simulatedNow: NOW, demoMode: true });
  if (p === '/api/auth/login') {
    const email = String(b.email ?? '');
    const user = profileForEmail(email);
    if (!user || b.password !== DEMO_PASSWORD) fail('ERR_AUTH', 'Invalid email or password', 401);
    return delay(token(user));
  }
  if (p === '/api/auth/register') {
    const base = profileFor(b.role as Role);
    return delay(token({ ...base, email: String(b.email), name: String(b.name), orgName: String(b.orgName), participantId: `p-${Date.now()}`, kycStatus: 'PENDING' }));
  }
  if (p === '/api/auth/refresh') return delay(token(current));
  if (p === '/api/auth/me') return delay(current);

  if (p === '/api/invoices/upload' && method === 'POST') {
    return delay({
      fileId: 'file-mock-1', fileHash: fakeHash('upload'), fileName: 'invoice-aurora-001.pdf', sizeBytes: 182_311,
      extraction: {
        supplierGstin: '27AAACS1234A1ZX', buyerGstin: '27AABCA3456D1ZX', supplierName: 'Sharma Precision Components', buyerName: 'Aurora Motors Ltd',
        invoiceNumber: 'INV-2025-001', invoiceDate: '2026-10-20', dueDate: '2026-12-26',
        lineItems: [
          { description: 'CNC machined aluminium housings (grade 6061)', quantity: 400, unitPricePaise: 52_000, totalPaise: 20_800_000, hsnCode: '76169990' },
          { description: 'Precision steel shafts, 20mm', quantity: 1200, unitPricePaise: 7_500, totalPaise: 9_000_000, hsnCode: '73181500' },
          { description: 'Inspection & packaging', quantity: 1, unitPricePaise: 4_098_300, totalPaise: 4_098_300, hsnCode: '998719' },
        ],
        totalAmountPaise: 40_000_000, taxAmountPaise: 6_101_700, confidence: 91,
        fieldConfidence: { supplierGstin: 96, buyerGstin: 93, invoiceNumber: 88, invoiceDate: 90, dueDate: 72, totalAmountPaise: 95, taxAmountPaise: 81 },
        warnings: ['Due date inferred from "Net 67" payment terms'], source: 'FALLBACK',
      },
      buyerId: 'buyer1', buyerName: 'Aurora Motors Ltd',
    }, 1800);
  }
  if (p === '/api/invoices' && method === 'POST') {
    if (b.invoiceNumber === 'INV-2025-001') {
      fail('ERR_DUPLICATE_INVOICE_ID', 'Invoice already tokenized (identity guard)', 409, { guard: 'DUPLICATE_INVOICE_ID', existingInvoiceId: invoices[0]?.invoiceId, existingStatus: invoices[0]?.status, anomalyTxId: fakeHash('anom-live') });
    }
    const inv = { ...invoices[0]!, invoiceId: fakeHash(`new-${Date.now()}`), status: 'DRAFT' as const, faceValuePaise: Number(b.faceValuePaise ?? 100_000), totalUnits: Number(b.faceValuePaise ?? 100_000) / 100_000 };
    invoices.unshift(inv);
    return delay({ invoice: inv, tx: tx() });
  }
  if (p === '/api/invoices' && method === 'GET') {
    let items = invoices;
    if (q.get('marketplace') === 'true') items = items.filter((i) => i.status === 'LISTED' || i.status === 'PARTIALLY_FUNDED');
    if (q.get('status')) items = items.filter((i) => i.status === q.get('status'));
    if (q.get('supplierId')) items = items.filter((i) => i.supplierId === q.get('supplierId'));
    if (q.get('buyerId')) items = items.filter((i) => i.buyerId === q.get('buyerId'));
    if (!q.get('supplierId') && !q.get('buyerId') && !q.get('marketplace')) {
      if (current.role === 'MSME') items = items.filter((i) => i.supplierId === current.participantId);
      if (current.role === 'BUYER') items = items.filter((i) => i.buyerId === current.participantId);
    }
    return delay({ items, nextBookmark: null });
  }
  if (seg[0] === 'api' && seg[1] === 'invoices' && seg[2]) {
    const id = seg[2];
    const idx = invoices.findIndex((i) => i.invoiceId === id);
    const inv = invoices[idx];
    if (!inv) fail('ERR_NOT_FOUND', 'invoice not found', 404);
    if (seg[3] === 'history') {
      const chain: InvoiceStatus[] = ['DRAFT', 'BUYER_ACCEPTED', 'LISTED', 'PARTIALLY_FUNDED', 'FULLY_FUNDED', 'SUPPLIER_PAID', 'SETTLED'];
      const upto = Math.max(0, chain.indexOf(inv.status));
      const fns = ['CreateInvoice', 'AcceptInvoice', 'ListInvoice', 'Invest', 'Invest', 'ReleaseSupplierPayout', 'RecordRepayment'];
      const actors = [inv.supplierId, inv.buyerId, 'operator1', 'investor1', 'investor2', 'operator1', inv.buyerId];
      const items = chain.slice(0, upto + 1).map((st, i) => ({
        txId: fakeHash(`hist-${id}-${i}`), timestamp: new Date(Date.parse('2026-10-02T08:00:00Z') + i * 3_600_000 * 20).toISOString(), isDelete: false,
        blockNumber: 10 + i, fn: fns[i], actorId: actors[i], value: { ...inv, status: i === upto ? inv.status : st },
      }));
      return delay({ items });
    }
    if (seg[3] === 'accept') return delay({ invoice: setStatus(id, 'BUYER_ACCEPTED'), tx: tx() });
    if (seg[3] === 'list') return delay({ invoice: setStatus(id, 'LISTED', { discountBps: Number(b.discountBps), minFundingUnits: Number(b.minFundingUnits), tenorDays: 60, pricePerUnitPaise: 98_685, annualizedYieldBps: 811, listedAt: new Date().toISOString() }), tx: tx() });
    if (seg[3] === 'cancel') return delay({ invoice: setStatus(id, 'CANCELLED', { cancelReason: String(b.reason) }), tx: tx() });
    if (seg[3] === 'pricing-preview') return delay({ unitFaceValuePaise: 100_000, discountBps: Number(q.get('discountBps')), tenorDays: 60, discountPerUnitPaise: 1315, pricePerUnitPaise: 98_685, yieldPerUnitPaise: 1315, annualizedYieldBps: 811 });
    const denied = current.role === 'REGULATOR' || current.role === 'INVESTOR';
    return delay({
      invoice: inv, privateDetails: denied ? null : privateDetailsFor(inv, idx + 1), privateAccess: denied ? (current.role === 'REGULATOR' ? 'DENIED_ORG' : 'DENIED_PARTICIPANT') : 'GRANTED',
      pricing: inv.discountBps ? { unitFaceValuePaise: 100_000, discountBps: inv.discountBps, tenorDays: inv.tenorDays, discountPerUnitPaise: 100_000 - inv.pricePerUnitPaise, pricePerUnitPaise: inv.pricePerUnitPaise, yieldPerUnitPaise: 100_000 - inv.pricePerUnitPaise, annualizedYieldBps: inv.annualizedYieldBps } : null,
      buyerScore: scoreFor(inv.buyerId).score, holdings: holdingsFor(inv), payments: paymentsFor(inv), supplierPayoutElapsedSeconds: inv.supplierPaidAt ? 135 : null,
    });
  }
  if (seg[1] === 'invest' && seg[3] === 'intent') {
    const inv = invoices.find((i) => i.invoiceId === seg[2]);
    const units = Number(b.units ?? 1);
    const amount = units * (inv?.pricePerUnitPaise ?? 98_532);
    return delay({ upiRef: `UPI-MOCK-${Date.now()}`, amountPaise: amount, units, deeplink: `upi://pay?pa=billbridge@upi&pn=BillBridge&am=${Math.trunc(amount / 100)}.${(amount % 100).toString().padStart(2, '0')}&cu=INR&tn=BillBridge`, qrDataUrl: '', payeeVpa: 'billbridge@upi', payeeName: 'BillBridge Escrow', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), status: 'INITIATED' });
  }
  if (p === '/api/invest/portfolio') return delay(PORTFOLIO);
  if (p === '/api/invest/upi') return delay({ items: [] });
  if (seg[1] === 'invest' && seg[2] === 'upi') return delay({ upiRef: seg[3], kind: 'FUNDING', direction: 'IN', status: 'SUCCESS', amountPaise: 985_320, invoiceId: invoices[2]?.invoiceId ?? null, participantId: 'investor1', payerVpa: 'priya.nair@upi', payeeVpa: 'billbridge@upi', deeplink: null, ledgerTxId: fakeHash('upi-tx'), errorCode: null, createdAt: NOW, updatedAt: NOW, expiresAt: null });

  if (seg[1] === 'settlement') {
    const id = seg[2] ?? '';
    const inv = invoices.find((i) => i.invoiceId === id);
    if (!inv) fail('ERR_NOT_FOUND', 'invoice not found', 404);
    if (seg[3] === 'supplier-payout') {
      const paid = setStatus(id, 'SUPPLIER_PAID', { supplierPaidAt: new Date().toISOString() });
      const payment = { upiRef: `UPI-P-${Date.now()}`, invoiceId: id, kind: 'SUPPLIER_PAYOUT' as const, fromId: 'platform', toId: inv.supplierId, amountPaise: inv.unitsSold * inv.pricePerUnitPaise, timestamp: new Date().toISOString() };
      return delay({ invoice: paid, payment, upi: { upiRef: payment.upiRef, kind: 'SUPPLIER_PAYOUT', direction: 'OUT', status: 'SUCCESS', amountPaise: payment.amountPaise, invoiceId: id, participantId: inv.supplierId, payerVpa: 'billbridge@upi', payeeVpa: 'supplier@upi', deeplink: null, ledgerTxId: null, errorCode: null, createdAt: NOW, updatedAt: NOW, expiresAt: null }, tx: tx() });
    }
    if (seg[3] === 'repayment-intent') {
      const amount = inv.faceValuePaise;
      return delay({ upiRef: `UPI-REPAY-${Date.now()}`, amountPaise: amount, deeplink: `upi://pay?pa=billbridge@upi&pn=BillBridge&am=${Math.trunc(amount / 100)}.00&cu=INR`, qrDataUrl: '', payeeVpa: 'billbridge@upi', payeeName: 'BillBridge Escrow', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), status: 'INITIATED' });
    }
    if (seg[3] === 'mark-late') return delay({ invoice: setStatus(id, 'LATE'), tx: tx() });
    if (seg[3] === 'mark-default') return delay({ invoice: setStatus(id, 'DEFAULTED'), buyerScore: scoreFor(inv.buyerId).score, holdings: holdingsFor(inv), tx: tx() });
  }

  if (p === '/api/platform/stats') return delay({ ...STATS, blockHeight: txCounter });
  if (seg[1] === 'platform' && seg[2] === 'scores') return delay(scoreFor(seg[3] ?? 'buyer1'));
  if (p === '/api/platform/reconciliation') return delay(RECONCILIATION);
  if (p === '/api/platform/audit/events') {
    let items = EVENTS;
    if (q.get('invoiceId')) items = items.filter((e) => e.invoiceId === q.get('invoiceId'));
    return delay({ items: [...items].reverse(), nextBookmark: null });
  }
  if (p === '/api/platform/anomalies') return delay({ items: ANOMALIES, nextBookmark: null });
  if (p === '/api/platform/participants') return delay({ items: PARTICIPANTS });
  if (seg[1] === 'platform' && seg[2] === 'kyc') {
    const part = PARTICIPANTS.find((x) => x.id === seg[3]);
    if (!part) fail('ERR_NOT_FOUND', 'participant not found', 404);
    part.kycStatus = b.status as typeof part.kycStatus;
    return delay(part);
  }
  if (seg[1] === 'platform' && seg[2] === 'freeze') {
    const part = PARTICIPANTS.find((x) => x.id === seg[3]);
    if (!part) fail('ERR_NOT_FOUND', 'participant not found', 404);
    part.frozen = Boolean(b.frozen); part.frozenReason = b.reason ? String(b.reason) : undefined;
    return delay(part);
  }
  if (p === '/api/platform/network') return delay({ ...NETWORK, blockHeight: txCounter });

  if (p === '/api/demo/state') return delay({ ...DEMO_STATE, lastCreatedInvoiceId: invoices[0]?.invoiceId ?? null });
  if (p === '/api/demo/seed' || p === '/api/demo/reset') return delay({ ok: true, ledgerMode: 'mock', users: 14, invoices: 8, durationMs: 420 }, 600);
  if (p === '/api/demo/time-travel') return delay({ simulatedNow: new Date(Date.parse(NOW) + Number(b.days ?? b.plusDays ?? 1) * 86_400_000).toISOString(), offsetSeconds: Number(b.days ?? b.plusDays ?? 1) * 86_400, tx: tx() });
  if (p === '/api/demo/simulate-payment') {
    const ref = String(b.upiRef);
    if (ref.startsWith('UPI-REPAY')) { const inv = invoices.find((i) => i.status === 'SUPPLIER_PAID'); if (inv) setStatus(inv.invoiceId, 'SETTLED', { settledAt: new Date().toISOString() }); }
    else { const inv = invoices.find((i) => i.status === 'LISTED'); if (inv) setStatus(inv.invoiceId, 'PARTIALLY_FUNDED', { unitsSold: inv.unitsSold + 10, availableUnits: inv.availableUnits - 10 }); }
    return delay({ upiRef: ref, status: b.fail ? 'FAILED' : 'SUCCESS', replayed: false, ledgerTxId: b.fail ? null : tx().txId, errorCode: null, message: b.fail ? 'Simulated failure' : 'Payment recorded on ledger' }, 900);
  }
  if (p === '/api/demo/attack/duplicate') {
    const variant = String(b.variant);
    const code = variant === 'SAME_FILE' ? 'ERR_DUPLICATE_FILE' : variant === 'NEW_NUMBER' ? 'ERR_DUPLICATE_INVOICE_CONTENT' : 'ERR_DUPLICATE_INVOICE_ID';
    const guard = variant === 'SAME_FILE' ? 'DUPLICATE_FILE' : variant === 'NEW_NUMBER' ? 'DUPLICATE_CONTENT' : 'DUPLICATE_INVOICE_ID';
    return delay({ variant, rejected: true, errorCode: code, message: `Ledger rejected the ${variant} attempt`, guard, anomalyTxId: tx().txId, targetInvoiceId: invoices[0]?.invoiceId ?? null }, 700);
  }
  if (p === '/api/demo/inject-mismatch') return delay({ upiRef: 'UPI-F-9z8y7x', reason: 'Amount altered by ₹100.00' });
  if (p === '/api/demo/switch-role') {
    const email = typeof b.email === 'string' ? b.email : DEMO_USER_BY_ROLE[b.role as Role];
    const user = profileForEmail(email ?? '');
    if (!user) fail('ERR_NOT_FOUND', 'unknown demo user', 404);
    return delay(token(user));
  }
  fail('ERR_NOT_FOUND', `mock: no handler for ${method} ${p}`, 404);
}
