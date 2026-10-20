/** UPI provider abstraction. The SimulatedUpiProvider is the default; NpciSandboxUpiProvider is a stub with the same shape. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { UpiWebhookPayloadSchema, type UpiStatus, type UpiWebhookPayload } from '@billbridge/shared';

export interface PaymentRequestInput {
  upiRef: string;
  amountPaise: number;
  payeeVpa: string;
  payeeName: string;
  note: string;
  expiresAt: Date;
}
export interface PaymentRequestOutput { upiRef: string; deeplink: string; qrDataUrl: string; expiresAt: Date }

export interface PayoutInput {
  upiRef: string;
  amountPaise: number;
  payeeVpa: string;
  participantId: string;
  kind: 'SUPPLIER_PAYOUT' | 'INVESTOR_DISTRIBUTION' | 'SUPPLIER_RESIDUAL' | 'REFUND';
  invoiceId: string | null;
  note?: string;
}
export interface PayoutOutput { upiRef: string; status: UpiStatus; providerTxnId: string; settledAt: Date }

export interface WebhookHeaders { signature: string | undefined; timestamp: string | undefined }
export type WebhookVerification = { ok: true; payload: UpiWebhookPayload } | { ok: false; code: 'ERR_UPI_SIGNATURE' | 'ERR_VALIDATION'; message: string };

export interface UpiProvider {
  readonly name: string;
  /** Build a collect/pay request (deeplink + QR). Pure: no state. */
  generatePaymentRequest(input: PaymentRequestInput): Promise<PaymentRequestOutput>;
  /** Provider-side status query (simulated: INITIATED until a webhook arrives). */
  verifyPayment(upiRef: string): Promise<{ upiRef: string; status: UpiStatus | 'UNKNOWN'; providerTxnId: string | null }>;
  /** Verify signature + timestamp skew and parse the raw webhook body. */
  processWebhook(rawBody: string, headers: WebhookHeaders, now?: Date): Promise<WebhookVerification>;
  /** Push money out (supplier, investor distribution, residual, refund). Simulated: instant SUCCESS. */
  initiatePayout(input: PayoutInput): Promise<PayoutOutput>;
}

export class NotConfiguredError extends Error {
  constructor(provider: string, method: string) { super(`${provider}.${method}: provider not configured (set NPCI_SANDBOX_* env vars)`); this.name = 'NotConfigured'; }
}

export function signWebhook(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhook(rawBody, secret), 'hex');
  let given: Buffer;
  try { given = Buffer.from(signature.trim().toLowerCase(), 'hex'); } catch { return false; }
  if (given.length !== expected.length || given.length === 0) return false;
  return timingSafeEqual(given, expected);
}

/** Shared verification logic (used by both providers). */
export function verifyWebhook(rawBody: string, headers: WebhookHeaders, secret: string, skewSeconds: number, now = new Date()): WebhookVerification {
  if (!verifyWebhookSignature(rawBody, headers.signature, secret)) return { ok: false, code: 'ERR_UPI_SIGNATURE', message: 'invalid x-upi-signature' };
  const ts = headers.timestamp;
  if (!ts) return { ok: false, code: 'ERR_UPI_SIGNATURE', message: 'missing x-upi-timestamp' };
  const t = /^\d+$/.test(ts) ? Number(ts) * (ts.length > 11 ? 1 : 1000) : Date.parse(ts);
  if (!Number.isFinite(t)) return { ok: false, code: 'ERR_UPI_SIGNATURE', message: 'invalid x-upi-timestamp' };
  if (Math.abs(now.getTime() - t) > skewSeconds * 1000) return { ok: false, code: 'ERR_UPI_SIGNATURE', message: `x-upi-timestamp outside ±${skewSeconds}s window` };
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return { ok: false, code: 'ERR_VALIDATION', message: 'webhook body is not JSON' }; }
  const parsed = UpiWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, code: 'ERR_VALIDATION', message: `webhook payload invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  return { ok: true, payload: parsed.data };
}
