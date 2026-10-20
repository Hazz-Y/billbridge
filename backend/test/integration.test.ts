import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_INVOICE, type AttackResponse, type InvoiceDetail, type InvoiceListResponse, type PaymentIntentResponse, type PortfolioResponse, type StatsResponse,
  type TokenResponse, type UploadResponse, type WebhookResult,
} from '@billbridge/shared';
import { REPO_ROOT } from '../src/config.js';
import { auth, login, signedWebhook, startHarness, type Harness } from './helpers.js';

let h: Harness;
let investor: TokenResponse;
let msme: TokenResponse;
let buyer: TokenResponse;
let operator: TokenResponse;
let regulator: TokenResponse;

function multipart(fileName: string, bytes: Buffer, mime = 'application/pdf') {
  const boundary = '----billbridge-test-boundary';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, bytes, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  h = await startHarness('integration');
  const seed = await h.app.inject({ method: 'POST', url: '/api/demo/seed' });
  expect(seed.statusCode, seed.body).toBe(200);
  expect(seed.json().invoices).toBe(8);
  const again = await h.app.inject({ method: 'POST', url: '/api/demo/seed' });
  expect(again.json().durationMs).toBeLessThan(2000);
  investor = await login(h.app, 'investor1@demo.in');
  msme = await login(h.app, 'msme1@demo.in');
  buyer = await login(h.app, 'buyer1@demo.in');
  operator = await login(h.app, 'operator@demo.in');
  regulator = await login(h.app, 'regulator@demo.in');
}, 60000);
afterAll(async () => { await h?.close(); });

describe('auth & roles', () => {
  it('401 without token, 403 with the wrong role, 200 for /me', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/invest/portfolio' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/api/invest/portfolio', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    const forbidden = await h.app.inject({ method: 'GET', url: '/api/invest/portfolio', headers: auth(msme) });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('ERR_FORBIDDEN');
    const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(investor) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ participantId: 'investor1', kycStatus: 'APPROVED', ledgerMode: 'mock' });
    const viaQuery = await h.app.inject({ method: 'GET', url: `/api/platform/audit/events?token=${investor.accessToken}&pageSize=5` });
    expect(viaQuery.statusCode).toBe(200);
  });
  it('refresh rotates tokens and rejects reuse', async () => {
    const r1 = await h.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: investor.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const r2 = await h.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: investor.refreshToken } });
    expect(r2.statusCode).toBe(401);
    investor = r1.json() as TokenResponse;
  });
  it('register creates a PENDING participant on-chain and validates input', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'new@demo.in', password: 'Secret123', name: 'New Investor', role: 'INVESTOR', orgName: 'Individual' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().user.kycStatus).toBe('PENDING');
    const bad = await h.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'x', password: '1' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('ERR_VALIDATION');
  });
});

describe('seeded state', () => {
  it('stats + marketplace + scores', async () => {
    const stats = (await h.app.inject({ method: 'GET', url: '/api/platform/stats' })).json() as StatsResponse;
    expect(stats.totalInvoices).toBe(8);
    expect(stats.ledgerMode).toBe('mock');
    const list = (await h.app.inject({ method: 'GET', url: '/api/invoices?marketplace=true', headers: auth(investor) })).json() as InvoiceListResponse;
    expect(list.items.map((i) => i.status).sort()).toEqual(['LISTED', 'PARTIALLY_FUNDED']);
    expect(list.items.every((i) => i.availableUnits > 0 && i.supplierName && i.buyerName)).toBe(true);
    const all = (await h.app.inject({ method: 'GET', url: '/api/invoices?pageSize=200', headers: auth(operator) })).json() as InvoiceListResponse;
    expect(all.items).toHaveLength(8);
    expect(new Set(all.items.map((i) => i.status))).toEqual(new Set(['DRAFT', 'BUYER_ACCEPTED', 'LISTED', 'PARTIALLY_FUNDED', 'FULLY_FUNDED', 'SUPPLIER_PAID', 'SETTLED', 'LATE']));
    const own = (await h.app.inject({ method: 'GET', url: '/api/invoices', headers: auth(msme) })).json() as InvoiceListResponse;
    expect(own.items.every((i) => i.supplierId === 'msme1')).toBe(true);
    const score = await h.app.inject({ method: 'GET', url: '/api/platform/scores/buyer1', headers: auth(investor) });
    expect(score.json().score.score).toBe(63);
    expect(score.json().history.length).toBeGreaterThanOrEqual(1);
    const b3 = await h.app.inject({ method: 'GET', url: '/api/platform/scores/buyer3', headers: auth(investor) });
    expect(b3.json().score.settledOnTime).toBe(4);
  });
  it('settled invoice detail has distribution payments and payout elapsed', async () => {
    const all = (await h.app.inject({ method: 'GET', url: '/api/invoices?status=SETTLED', headers: auth(operator) })).json() as InvoiceListResponse;
    const d = (await h.app.inject({ method: 'GET', url: `/api/invoices/${all.items[0]?.invoiceId}`, headers: auth(operator) })).json() as InvoiceDetail;
    expect(d.privateAccess).toBe('GRANTED');
    expect(d.payments.some((p) => p.kind === 'INVESTOR_DISTRIBUTION' && p.txId)).toBe(true);
    expect(d.payments.some((p) => p.kind === 'SUPPLIER_RESIDUAL')).toBe(true);
    expect(d.supplierPayoutElapsedSeconds).toBeGreaterThan(0);
    const reg = (await h.app.inject({ method: 'GET', url: `/api/invoices/${all.items[0]?.invoiceId}`, headers: auth(regulator) })).json() as InvoiceDetail;
    expect(reg.privateAccess).toBe('DENIED_ORG');
    expect(reg.privateDetails).toBeNull();
    const inv = (await h.app.inject({ method: 'GET', url: `/api/invoices/${all.items[0]?.invoiceId}`, headers: auth(investor) })).json() as InvoiceDetail;
    expect(inv.privateAccess).toBe('DENIED_PARTICIPANT');
  });
  it('reconciliation is clean after seed, flags an injected mismatch', async () => {
    const r1 = (await h.app.inject({ method: 'GET', url: '/api/platform/reconciliation', headers: auth(operator) })).json();
    expect(r1.summary.flagged).toBe(0);
    expect(r1.summary.total).toBeGreaterThan(5);
    await h.app.inject({ method: 'POST', url: '/api/demo/inject-mismatch' });
    const r2 = (await h.app.inject({ method: 'GET', url: '/api/platform/reconciliation', headers: auth(regulator) })).json();
    expect(r2.rows.filter((r: { classification: string }) => r.classification === 'AMOUNT_MISMATCH')).toHaveLength(1);
  });
});

describe('invest via UPI webhook', () => {
  let intent: PaymentIntentResponse;
  let listedId: string;
  it('creates an intent with deeplink + QR and reserves units', async () => {
    const list = (await h.app.inject({ method: 'GET', url: '/api/invoices?marketplace=true', headers: auth(investor) })).json() as InvoiceListResponse;
    const listed = list.items.find((i) => i.status === 'LISTED');
    if (!listed) throw new Error('no LISTED invoice');
    listedId = listed.invoiceId;
    const r = await h.app.inject({ method: 'POST', url: `/api/invest/${listedId}/intent`, headers: auth(investor), payload: { units: 10 } });
    expect(r.statusCode, r.body).toBe(200);
    intent = r.json() as PaymentIntentResponse;
    expect(intent.deeplink).toContain('upi://pay?pa=billbridge%40upi');
    expect(intent.amountPaise).toBe(10 * listed.pricePerUnitPaise);
    expect(intent.qrDataUrl.startsWith('data:image/png')).toBe(true);
    const after = (await h.app.inject({ method: 'GET', url: `/api/invoices/${listedId}`, headers: auth(investor) })).json() as InvoiceDetail;
    expect(after.invoice.reservedUnits).toBe(10);
    expect(after.invoice.availableUnits).toBe(listed.availableUnits - 10);
  });
  it('rejects a webhook with a bad signature', async () => {
    const w = signedWebhook({ upiRef: intent.upiRef, status: 'SUCCESS', amountPaise: intent.amountPaise, payerVpa: 'priya.nair@upi', timestamp: new Date().toISOString(), providerTxnId: 'T1' }, 'wrong');
    const r = await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w.headers, payload: w.body });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('ERR_UPI_SIGNATURE');
  });
  it('settles the funding on-chain and replays idempotently', async () => {
    const w = signedWebhook({ upiRef: intent.upiRef, status: 'SUCCESS', amountPaise: intent.amountPaise, payerVpa: 'priya.nair@upi', timestamp: new Date().toISOString(), providerTxnId: 'T1' });
    const r = await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w.headers, payload: w.body });
    expect(r.statusCode, r.body).toBe(200);
    const res = r.json() as WebhookResult;
    expect(res.status).toBe('SUCCESS');
    expect(res.replayed).toBe(false);
    expect(res.ledgerTxId).toBeTruthy();
    const again = (await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w.headers, payload: w.body })).json() as WebhookResult;
    expect(again.replayed).toBe(true);
    expect(again.ledgerTxId).toBe(res.ledgerTxId);
    const pf = (await h.app.inject({ method: 'GET', url: '/api/invest/portfolio', headers: auth(investor) })).json() as PortfolioResponse;
    const pos = pf.positions.find((p) => p.invoiceId === listedId);
    expect(pos?.units).toBe(10);
    expect(pos?.costPaise).toBe(intent.amountPaise);
    expect(pos?.invoiceNumberMasked).toMatch(/^INV-…/);
    const tx = await h.app.inject({ method: 'GET', url: `/api/invest/upi/${intent.upiRef}`, headers: auth(investor) });
    expect(tx.json().status).toBe('SUCCESS');
    await h.ctx.events.flush();
    const ev = await h.app.inject({ method: 'GET', url: '/api/platform/audit/events?pageSize=100&type=Invest', headers: auth(investor) });
    expect(ev.json().items.some((e: { txId: string }) => e.txId === res.ledgerTxId)).toBe(true);
  });
  it('expires stale intents and releases their reservation', async () => {
    const r = await h.app.inject({ method: 'POST', url: `/api/invest/${listedId}/intent`, headers: auth(investor), payload: { units: 3 } });
    const stale = r.json() as PaymentIntentResponse;
    await h.ctx.db.upiTransaction.update({ where: { upiRef: stale.upiRef }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.ctx.db.upiReservation.updateMany({ where: { upiRef: stale.upiRef }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const w = signedWebhook({ upiRef: stale.upiRef, status: 'SUCCESS', amountPaise: stale.amountPaise, payerVpa: 'x@upi', timestamp: new Date().toISOString(), providerTxnId: 'T2' });
    const res = (await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w.headers, payload: w.body })).json() as WebhookResult;
    expect(res.status).toBe('EXPIRED');
    const detail = (await h.app.inject({ method: 'GET', url: `/api/invoices/${listedId}`, headers: auth(investor) })).json() as InvoiceDetail;
    expect(detail.invoice.reservedUnits).toBe(0);
  });
  it('refunds when the ledger rejects (cap exceeded) and records an anomaly', async () => {
    const r = await h.app.inject({ method: 'POST', url: `/api/invest/${listedId}/intent`, headers: auth(investor), payload: { units: 2 } });
    const i2 = r.json() as PaymentIntentResponse;
    await h.ctx.ledger.freezeParticipant({ mspId: 'Org1MSP', role: 'OPERATOR', participantId: 'operator1' }, 'investor1', 'test freeze');
    const w = signedWebhook({ upiRef: i2.upiRef, status: 'SUCCESS', amountPaise: i2.amountPaise, payerVpa: 'x@upi', timestamp: new Date().toISOString(), providerTxnId: 'T3' });
    const res = (await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w.headers, payload: w.body })).json() as WebhookResult;
    expect(res.status).toBe('REFUND_REQUIRED');
    expect(res.errorCode).toBe('ERR_PARTICIPANT_FROZEN');
    await h.ctx.ledger.unfreezeParticipant({ mspId: 'Org1MSP', role: 'OPERATOR', participantId: 'operator1' }, 'investor1');
    const refund = await h.ctx.db.upiTransaction.findUnique({ where: { upiRef: `${i2.upiRef}-X` } });
    expect(refund?.kind).toBe('REFUND');
    const recon = (await h.app.inject({ method: 'GET', url: '/api/platform/reconciliation', headers: auth(operator) })).json();
    expect(recon.rows.some((x: { upiRef: string; classification: string }) => x.upiRef === i2.upiRef && x.classification === 'REFUND_REQUIRED')).toBe(true);
  });
});

describe('upload, tokenize, duplicate attack', () => {
  let upload: UploadResponse;
  let invoiceId: string;
  it('uploads the sample PDF and extracts it', async () => {
    const pdf = readFileSync(resolve(REPO_ROOT, 'samples', 'invoice-aurora-001.pdf'));
    const m = multipart('invoice-aurora-001.pdf', pdf);
    const r = await h.app.inject({ method: 'POST', url: '/api/invoices/upload', headers: { ...auth(msme), ...m.headers }, payload: m.payload });
    expect(r.statusCode, r.body).toBe(200);
    upload = r.json() as UploadResponse;
    expect(upload.buyerId).toBe('buyer1');
    expect(upload.extraction.totalAmountPaise).toBe(DEMO_INVOICE.faceValuePaise);
    expect(upload.extraction.confidence).toBeGreaterThanOrEqual(85);
  });
  it('tokenizes the invoice and accepts it as the buyer', async () => {
    const e = upload.extraction;
    const body = { fileId: upload.fileId, buyerId: 'buyer1', supplierGstin: e.supplierGstin, buyerGstin: e.buyerGstin, invoiceNumber: e.invoiceNumber, issueDate: e.invoiceDate, dueDate: e.dueDate, faceValuePaise: e.totalAmountPaise, taxAmountPaise: e.taxAmountPaise, lineItems: e.lineItems };
    const r = await h.app.inject({ method: 'POST', url: '/api/invoices', headers: auth(msme), payload: body });
    expect(r.statusCode, r.body).toBe(200);
    invoiceId = r.json().invoice.invoiceId;
    expect(r.json().invoice.totalUnits).toBe(400);
    const acc = await h.app.inject({ method: 'POST', url: `/api/invoices/${invoiceId}/accept`, headers: auth(buyer) });
    expect(acc.statusCode, acc.body).toBe(200);
    expect(acc.json().invoice.status).toBe('BUYER_ACCEPTED');
    const wrong = await h.app.inject({ method: 'POST', url: `/api/invoices/${invoiceId}/list`, headers: auth(msme), payload: { discountBps: 800, minFundingUnits: 100 } });
    expect(wrong.statusCode).toBe(403);
    const listed = await h.app.inject({ method: 'POST', url: `/api/invoices/${invoiceId}/list`, headers: auth(operator), payload: { discountBps: 800, minFundingUnits: 100 } });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().invoice.pricePerUnitPaise).toBeLessThan(100000);
    const hist = await h.app.inject({ method: 'GET', url: `/api/invoices/${invoiceId}/history`, headers: auth(msme) });
    expect(hist.json().items.length).toBe(3);
  });
  it('rejects all three duplicate variants with 409 + anomaly, visible to the regulator', async () => {
    const before = (await h.app.inject({ method: 'GET', url: '/api/platform/anomalies?pageSize=100', headers: auth(regulator) })).json().items.length;
    const expected: Record<string, string> = { SAME_FILE: 'ERR_DUPLICATE_FILE', NEW_NUMBER: 'ERR_DUPLICATE_INVOICE_CONTENT', CHANGED_AMOUNT: 'ERR_DUPLICATE_INVOICE_ID' };
    for (const variant of ['SAME_FILE', 'NEW_NUMBER', 'CHANGED_AMOUNT'] as const) {
      const r = await h.app.inject({ method: 'POST', url: '/api/demo/attack/duplicate', payload: { variant } });
      expect(r.statusCode, r.body).toBe(200);
      const a = r.json() as AttackResponse;
      expect(a.rejected, variant).toBe(true);
      expect(a.errorCode, variant).toBe(expected[variant]);
      expect(a.anomalyTxId, variant).toBeTruthy();
      expect(a.guard, variant).toMatch(/Guard #/);
      expect(a.targetInvoiceId).toBe(invoiceId);
    }
    // direct re-submit through the API: 409 with details
    const e = upload.extraction;
    const dup = await h.app.inject({ method: 'POST', url: '/api/invoices', headers: auth(msme), payload: { fileId: upload.fileId, buyerId: 'buyer1', supplierGstin: e.supplierGstin, buyerGstin: e.buyerGstin, invoiceNumber: e.invoiceNumber, issueDate: e.invoiceDate, dueDate: e.dueDate, faceValuePaise: e.totalAmountPaise, taxAmountPaise: e.taxAmountPaise, lineItems: e.lineItems } });
    expect(dup.statusCode).toBe(409);
    const err = dup.json().error;
    expect(err.code).toBe('ERR_DUPLICATE_INVOICE_ID');
    expect(err.details).toMatchObject({ guard: 'IDENTITY', existingInvoiceId: invoiceId, existingStatus: 'LISTED' });
    expect(err.details.anomalyTxId).toBeTruthy();
    expect(err.details.existingTxId).toBeTruthy();
    await h.ctx.events.flush();
    const after = (await h.app.inject({ method: 'GET', url: '/api/platform/anomalies?pageSize=100', headers: auth(regulator) })).json();
    expect(after.items.length).toBe(before + 4);
    expect(after.items[0].guard).toMatch(/Guard #/);
    const denied = await h.app.inject({ method: 'GET', url: '/api/platform/anomalies', headers: auth(investor) });
    expect(denied.statusCode).toBe(403);
  });
  it('time travel + repayment flow settles with a score change', async () => {
    const inv1 = await h.app.inject({ method: 'POST', url: `/api/invest/${invoiceId}/intent`, headers: auth(investor), payload: { units: 400 } });
    expect(inv1.statusCode, inv1.body).toBe(200);
    const i = inv1.json() as PaymentIntentResponse;
    const w = signedWebhook({ upiRef: i.upiRef, status: 'SUCCESS', amountPaise: i.amountPaise, payerVpa: 'priya.nair@upi', timestamp: new Date().toISOString(), providerTxnId: 'T9' });
    const res = (await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w.headers, payload: w.body })).json() as WebhookResult;
    expect(res.status).toBe('SUCCESS');
    const d = (await h.app.inject({ method: 'GET', url: `/api/invoices/${invoiceId}`, headers: auth(msme) })).json() as InvoiceDetail;
    expect(d.invoice.status).toBe('SUPPLIER_PAID'); // auto supplier payout
    expect(d.invoice.supplierPaidAt).toBeTruthy();
    expect(d.supplierPayoutElapsedSeconds).not.toBeNull();
    const tt = await h.app.inject({ method: 'POST', url: '/api/demo/time-travel', payload: { toInvoiceId: invoiceId, plusDays: -1 } });
    expect(tt.statusCode, tt.body).toBe(200);
    const ri = await h.app.inject({ method: 'POST', url: `/api/settlement/${invoiceId}/repayment-intent`, headers: auth(buyer) });
    expect(ri.statusCode, ri.body).toBe(200);
    const rp = ri.json() as PaymentIntentResponse;
    expect(rp.amountPaise).toBe(DEMO_INVOICE.faceValuePaise);
    const w2 = signedWebhook({ upiRef: rp.upiRef, status: 'SUCCESS', amountPaise: rp.amountPaise, payerVpa: 'auroramotors@upi', timestamp: new Date().toISOString(), providerTxnId: 'T10' });
    const r2 = (await h.app.inject({ method: 'POST', url: '/api/invest/webhook', headers: w2.headers, payload: w2.body })).json() as WebhookResult;
    expect(r2.status).toBe('SUCCESS');
    const score = await h.app.inject({ method: 'GET', url: '/api/platform/scores/buyer1', headers: auth(investor) });
    expect(score.json().score.score).toBe(67);
    const pf = (await h.app.inject({ method: 'GET', url: '/api/invest/portfolio', headers: auth(investor) })).json() as PortfolioResponse;
    const pos = pf.positions.find((p) => p.invoiceId === invoiceId);
    expect(pos?.status).toBe('SETTLED');
    expect(pos?.realizedPaise).toBe(DEMO_INVOICE.faceValuePaise);
    const sw = await h.app.inject({ method: 'POST', url: '/api/demo/switch-role', payload: { role: 'REGULATOR' } });
    expect(sw.json().user.participantId).toBe('regulator1');
    const csv = await h.app.inject({ method: 'GET', url: `/api/platform/audit/events?format=csv&pageSize=200&token=${regulator.accessToken}` });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n').length).toBeGreaterThan(10);
  });
});
