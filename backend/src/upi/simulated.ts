/** SimulatedUpiProvider — deterministic, offline UPI rails for the sandbox demo. */
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { paiseToDecimalString } from '@billbridge/shared';
import {
  verifyWebhook, type PaymentRequestInput, type PaymentRequestOutput, type PayoutInput, type PayoutOutput, type UpiProvider,
  type WebhookHeaders, type WebhookVerification,
} from './provider.js';

export function buildDeeplink(input: { payeeVpa: string; payeeName: string; amountPaise: number; upiRef: string; note: string }): string {
  const params = [
    `pa=${encodeURIComponent(input.payeeVpa)}`,
    `pn=${encodeURIComponent(input.payeeName)}`,
    `am=${paiseToDecimalString(input.amountPaise)}`,
    'cu=INR',
    `tr=${encodeURIComponent(input.upiRef)}`,
    `tn=${encodeURIComponent(input.note)}`,
  ];
  return `upi://pay?${params.join('&')}`;
}

export class SimulatedUpiProvider implements UpiProvider {
  readonly name = 'simulated';
  constructor(private readonly opts: { webhookSecret: string; skewSeconds: number }) {}

  async generatePaymentRequest(input: PaymentRequestInput): Promise<PaymentRequestOutput> {
    const deeplink = buildDeeplink({ payeeVpa: input.payeeVpa, payeeName: input.payeeName, amountPaise: input.amountPaise, upiRef: input.upiRef, note: input.note });
    const qrDataUrl = await QRCode.toDataURL(deeplink, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
    return { upiRef: input.upiRef, deeplink, qrDataUrl, expiresAt: input.expiresAt };
  }

  async verifyPayment(upiRef: string) {
    // The simulator has no out-of-band ledger: status is whatever the webhook last told us (tracked in SQLite by the service).
    return { upiRef, status: 'UNKNOWN' as const, providerTxnId: null };
  }

  async processWebhook(rawBody: string, headers: WebhookHeaders, now = new Date()): Promise<WebhookVerification> {
    return verifyWebhook(rawBody, headers, this.opts.webhookSecret, this.opts.skewSeconds, now);
  }

  async initiatePayout(input: PayoutInput): Promise<PayoutOutput> {
    return { upiRef: input.upiRef, status: 'SUCCESS', providerTxnId: `SIM${randomBytes(6).toString('hex').toUpperCase()}`, settledAt: new Date() };
  }
}
