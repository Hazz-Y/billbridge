import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook, verifyWebhookSignature } from '../src/upi/provider.js';
import { SimulatedUpiProvider, buildDeeplink } from '../src/upi/simulated.js';
import { newUpiRef } from '../src/upi/service.js';

const secret = 'test-secret';
const payload = { upiRef: 'BB-F-1-ABCD', status: 'SUCCESS', amountPaise: 985320, payerVpa: 'priya.nair@upi', timestamp: '2026-10-20T10:00:00Z', providerTxnId: 'P1' };
const raw = JSON.stringify(payload);

describe('UPI webhook verification', () => {
  it('accepts a valid HMAC with a fresh timestamp', () => {
    const r = verifyWebhook(raw, { signature: signWebhook(raw, secret), timestamp: String(Math.floor(Date.now() / 1000)) }, secret, 300);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.amountPaise).toBe(985320);
  });
  it('rejects a bad signature (constant-time compare, wrong length too)', () => {
    expect(verifyWebhookSignature(raw, 'deadbeef', secret)).toBe(false);
    expect(verifyWebhookSignature(raw, signWebhook(raw, 'other'), secret)).toBe(false);
    expect(verifyWebhookSignature(raw, undefined, secret)).toBe(false);
    const r = verifyWebhook(raw, { signature: signWebhook(raw, 'other'), timestamp: String(Math.floor(Date.now() / 1000)) }, secret, 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ERR_UPI_SIGNATURE');
  });
  it('rejects timestamp skew beyond ±5 minutes (unix seconds, millis and ISO accepted)', () => {
    const sig = signWebhook(raw, secret);
    const old = verifyWebhook(raw, { signature: sig, timestamp: String(Math.floor(Date.now() / 1000) - 600) }, secret, 300);
    expect(old.ok).toBe(false);
    const iso = verifyWebhook(raw, { signature: sig, timestamp: new Date().toISOString() }, secret, 300);
    expect(iso.ok).toBe(true);
    const ms = verifyWebhook(raw, { signature: sig, timestamp: String(Date.now()) }, secret, 300);
    expect(ms.ok).toBe(true);
    const missing = verifyWebhook(raw, { signature: sig, timestamp: undefined }, secret, 300);
    expect(missing.ok).toBe(false);
  });
  it('rejects a payload that does not match the schema', () => {
    const bad = JSON.stringify({ ...payload, amountPaise: 12.5 });
    const r = verifyWebhook(bad, { signature: signWebhook(bad, secret), timestamp: String(Math.floor(Date.now() / 1000)) }, secret, 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ERR_VALIDATION');
  });
});

describe('SimulatedUpiProvider', () => {
  it('builds a upi:// deeplink with decimal rupees and a QR data URL', async () => {
    const link = buildDeeplink({ payeeVpa: 'billbridge@upi', payeeName: 'BillBridge Escrow', amountPaise: 985320, upiRef: 'BB-F-X-1234', note: 'test' });
    expect(link).toBe('upi://pay?pa=billbridge%40upi&pn=BillBridge%20Escrow&am=9853.20&cu=INR&tr=BB-F-X-1234&tn=test');
    const p = new SimulatedUpiProvider({ webhookSecret: secret, skewSeconds: 300 });
    const r = await p.generatePaymentRequest({ upiRef: 'BB-F-X-1234', amountPaise: 985320, payeeVpa: 'billbridge@upi', payeeName: 'BillBridge Escrow', note: 'test', expiresAt: new Date() });
    expect(r.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const payout = await p.initiatePayout({ upiRef: 'X', amountPaise: 1, payeeVpa: 'a@upi', participantId: 'msme1', kind: 'SUPPLIER_PAYOUT', invoiceId: null });
    expect(payout.status).toBe('SUCCESS');
  });
  it('formats upiRefs as BB-<KIND>-<base36>-<4>', () => {
    expect(newUpiRef('FUNDING')).toMatch(/^BB-F-[0-9A-Z]+-[A-Z0-9]{4}$/);
    expect(newUpiRef('BUYER_REPAYMENT')).toMatch(/^BB-R-/);
  });
});
