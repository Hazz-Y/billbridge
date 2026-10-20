/** NpciSandboxUpiProvider — placeholder for the NPCI UPI sandbox. Same interface; every call throws until NPCI_SANDBOX_* is set. */
import { NotConfiguredError, type PaymentRequestInput, type PaymentRequestOutput, type PayoutInput, type PayoutOutput, type UpiProvider, type WebhookHeaders, type WebhookVerification } from './provider.js';

export class NpciSandboxUpiProvider implements UpiProvider {
  readonly name = 'npci-sandbox';
  constructor(private readonly cfg: { baseUrl: string; clientId: string; clientSecret: string }) {}
  private ensure(method: string): never {
    throw new NotConfiguredError('NpciSandboxUpiProvider', `${method} (baseUrl=${this.cfg.baseUrl || 'unset'}, clientId=${this.cfg.clientId ? 'set' : 'unset'})`);
  }
  async generatePaymentRequest(_i: PaymentRequestInput): Promise<PaymentRequestOutput> { return this.ensure('generatePaymentRequest'); }
  async verifyPayment(_upiRef: string): Promise<{ upiRef: string; status: 'UNKNOWN'; providerTxnId: null }> { return this.ensure('verifyPayment'); }
  async processWebhook(_raw: string, _h: WebhookHeaders): Promise<WebhookVerification> { return this.ensure('processWebhook'); }
  async initiatePayout(_i: PayoutInput): Promise<PayoutOutput> { return this.ensure('initiatePayout'); }
}
