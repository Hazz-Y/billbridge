import { z } from 'zod';
import {
  AnomalyRecordSchema, AuditEntrySchema, BuyerScoreSchema, HistoryEntrySchema, HoldingSchema, InvoicePrivateDetailsSchema,
  InvoiceSchema, LedgerConfigSchema, PaymentRecordSchema, ParticipantSchema, PlatformStatsSchema, pageOf,
  type AnomalyRecord, type AuditEntry, type BuyerScore, type HistoryEntry, type Holding, type Invoice,
  type InvoicePrivateDetails, type LedgerConfig, type Page, type PaymentRecord, type Participant, type PlatformStats,
} from './domain.js';
import type { CallerIdentity, LedgerClient, SubmitOptions, TxResult } from './ledger-client.js';
import { encodeArgs } from './ledger-client.js';

/** Typed results of chaincode functions (shared by chaincode JSON, MockLedger and backend). */
export const InvestResultSchema = z.object({
  invoice: InvoiceSchema, holding: HoldingSchema, payment: PaymentRecordSchema, replayed: z.boolean(),
});
export type InvestResult = z.infer<typeof InvestResultSchema>;

export const ReleaseResultSchema = z.object({ invoice: InvoiceSchema, payment: PaymentRecordSchema });
export type ReleaseResult = z.infer<typeof ReleaseResultSchema>;

export const RepaymentResultSchema = z.object({
  invoice: InvoiceSchema,
  repayment: PaymentRecordSchema,
  distributions: z.array(PaymentRecordSchema),
  residual: PaymentRecordSchema.nullable(),
  buyerScore: BuyerScoreSchema,
  onTime: z.boolean(),
});
export type RepaymentResult = z.infer<typeof RepaymentResultSchema>;

export const DefaultResultSchema = z.object({
  invoice: InvoiceSchema, buyerScore: BuyerScoreSchema, holdings: z.array(HoldingSchema),
});
export type DefaultResult = z.infer<typeof DefaultResultSchema>;

export const ClockSchema = z.object({ now: z.string(), offsetSeconds: z.number().int(), demoMode: z.boolean() });
export type Clock = z.infer<typeof ClockSchema>;

const InvoicePage = pageOf(InvoiceSchema);
const ParticipantPage = pageOf(ParticipantSchema);
const AnomalyPage = pageOf(AnomalyRecordSchema);
const AuditPage = pageOf(AuditEntrySchema);
const PaymentPage = pageOf(PaymentRecordSchema);

/**
 * Typed wrapper around a LedgerClient: encodes args, parses results with Zod.
 * The backend talks to the ledger ONLY through this class, so swapping mock <-> Fabric is a one-liner.
 */
export class LedgerApi {
  constructor(public readonly client: LedgerClient) {}

  private async tx<T>(caller: CallerIdentity, fn: string, args: unknown[], schema: z.ZodType<T, z.ZodTypeDef, unknown>, opts?: SubmitOptions): Promise<TxResult<T>> {
    const r = await this.client.submit(caller, fn, encodeArgs(args), opts);
    return { ...r, data: schema.parse(r.data) };
  }
  private async q<T>(caller: CallerIdentity, fn: string, args: unknown[], schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    return schema.parse(await this.client.evaluate(caller, fn, encodeArgs(args)));
  }

  // ── participants ──
  registerParticipant(c: CallerIdentity, id: string, role: string, orgMsp: string, perInvoiceCapPaise: number, o?: SubmitOptions) {
    return this.tx(c, 'RegisterParticipant', [id, role, orgMsp, perInvoiceCapPaise], ParticipantSchema, o);
  }
  setKycStatus(c: CallerIdentity, participantId: string, status: string, kycDocHash: string, o?: SubmitOptions) {
    return this.tx(c, 'SetKycStatus', [participantId, status, kycDocHash], ParticipantSchema, o);
  }
  freezeParticipant(c: CallerIdentity, participantId: string, reason: string, o?: SubmitOptions) {
    return this.tx(c, 'FreezeParticipant', [participantId, reason], ParticipantSchema, o);
  }
  unfreezeParticipant(c: CallerIdentity, participantId: string, o?: SubmitOptions) {
    return this.tx(c, 'UnfreezeParticipant', [participantId], ParticipantSchema, o);
  }

  // ── invoice lifecycle ──
  createInvoice(c: CallerIdentity, supplierId: string, buyerId: string, faceValuePaise: number, issueDate: string, dueDate: string, privateDetails: InvoicePrivateDetails, o?: SubmitOptions) {
    return this.tx(c, 'CreateInvoice', [supplierId, buyerId, faceValuePaise, issueDate, dueDate, privateDetails], InvoiceSchema, o);
  }
  buyerAcceptInvoice(c: CallerIdentity, invoiceId: string, o?: SubmitOptions) {
    return this.tx(c, 'BuyerAcceptInvoice', [invoiceId], InvoiceSchema, o);
  }
  listInvoice(c: CallerIdentity, invoiceId: string, discountBps: number, minFundingUnits: number, o?: SubmitOptions) {
    return this.tx(c, 'ListInvoice', [invoiceId, discountBps, minFundingUnits], InvoiceSchema, o);
  }
  cancelInvoice(c: CallerIdentity, invoiceId: string, reason: string, o?: SubmitOptions) {
    return this.tx(c, 'CancelInvoice', [invoiceId, reason], InvoiceSchema, o);
  }

  // ── investment & settlement ──
  invest(c: CallerIdentity, invoiceId: string, investorId: string, units: number, upiRef: string, o?: SubmitOptions) {
    return this.tx(c, 'Invest', [invoiceId, investorId, units, upiRef], InvestResultSchema, o);
  }
  releaseToSupplier(c: CallerIdentity, invoiceId: string, upiRef: string, o?: SubmitOptions) {
    return this.tx(c, 'ReleaseToSupplier', [invoiceId, upiRef], ReleaseResultSchema, o);
  }
  recordRepayment(c: CallerIdentity, invoiceId: string, upiRef: string, amountPaise: number, o?: SubmitOptions) {
    return this.tx(c, 'RecordRepayment', [invoiceId, upiRef, amountPaise], RepaymentResultSchema, o);
  }
  markLate(c: CallerIdentity, invoiceId: string, o?: SubmitOptions) {
    return this.tx(c, 'MarkLate', [invoiceId], InvoiceSchema, o);
  }
  markDefault(c: CallerIdentity, invoiceId: string, o?: SubmitOptions) {
    return this.tx(c, 'MarkDefault', [invoiceId], DefaultResultSchema, o);
  }

  // ── anomalies & demo ──
  recordAnomaly(c: CallerIdentity, kind: string, actorId: string, invoiceRef: string, errorCode: string, detail: string, o?: SubmitOptions) {
    return this.tx(c, 'RecordAnomaly', [kind, actorId, invoiceRef, errorCode, detail], AnomalyRecordSchema, o);
  }
  advanceDemoClock(c: CallerIdentity, seconds: number, o?: SubmitOptions) {
    return this.tx(c, 'AdvanceDemoClock', [seconds], ClockSchema, o);
  }
  seedBuyerHistory(c: CallerIdentity, buyerId: string, onTime: number, late: number, defaulted: number, o?: SubmitOptions) {
    return this.tx(c, 'SeedBuyerHistory', [buyerId, onTime, late, defaulted], BuyerScoreSchema, o);
  }

  // ── queries ──
  getInvoice(c: CallerIdentity, invoiceId: string): Promise<Invoice> { return this.q(c, 'GetInvoice', [invoiceId], InvoiceSchema); }
  getInvoicePrivateDetails(c: CallerIdentity, invoiceId: string): Promise<InvoicePrivateDetails> {
    return this.q(c, 'GetInvoicePrivateDetails', [invoiceId], InvoicePrivateDetailsSchema);
  }
  listInvoicesByStatus(c: CallerIdentity, status: string, pageSize: number, bookmark: string): Promise<Page<Invoice>> {
    return this.q(c, 'ListInvoicesByStatus', [status, pageSize, bookmark], InvoicePage);
  }
  listInvoicesBySupplier(c: CallerIdentity, supplierId: string, pageSize: number, bookmark: string): Promise<Page<Invoice>> {
    return this.q(c, 'ListInvoicesBySupplier', [supplierId, pageSize, bookmark], InvoicePage);
  }
  listInvoicesByBuyer(c: CallerIdentity, buyerId: string, pageSize: number, bookmark: string): Promise<Page<Invoice>> {
    return this.q(c, 'ListInvoicesByBuyer', [buyerId, pageSize, bookmark], InvoicePage);
  }
  listAllInvoices(c: CallerIdentity, pageSize: number, bookmark: string): Promise<Page<Invoice>> {
    return this.q(c, 'ListAllInvoices', [pageSize, bookmark], InvoicePage);
  }
  getHoldingsByInvoice(c: CallerIdentity, invoiceId: string): Promise<Holding[]> {
    return this.q(c, 'GetHoldingsByInvoice', [invoiceId], z.array(HoldingSchema));
  }
  getHoldingsByInvestor(c: CallerIdentity, investorId: string): Promise<Holding[]> {
    return this.q(c, 'GetHoldingsByInvestor', [investorId], z.array(HoldingSchema));
  }
  getInvoiceHistory(c: CallerIdentity, invoiceId: string): Promise<HistoryEntry[]> {
    return this.q(c, 'GetInvoiceHistory', [invoiceId], z.array(HistoryEntrySchema));
  }
  getBuyerScore(c: CallerIdentity, buyerId: string): Promise<BuyerScore> { return this.q(c, 'GetBuyerScore', [buyerId], BuyerScoreSchema); }
  getParticipant(c: CallerIdentity, participantId: string): Promise<Participant> {
    return this.q(c, 'GetParticipant', [participantId], ParticipantSchema);
  }
  listParticipants(c: CallerIdentity, pageSize: number, bookmark: string): Promise<Page<Participant>> {
    return this.q(c, 'ListParticipants', [pageSize, bookmark], ParticipantPage);
  }
  getPlatformStats(c: CallerIdentity): Promise<PlatformStats> { return this.q(c, 'GetPlatformStats', [], PlatformStatsSchema); }
  getAnomalies(c: CallerIdentity, pageSize: number, bookmark: string): Promise<Page<AnomalyRecord>> {
    return this.q(c, 'GetAnomalies', [pageSize, bookmark], AnomalyPage);
  }
  getAuditTrail(c: CallerIdentity, startTime: string, endTime: string, pageSize: number, bookmark: string): Promise<Page<AuditEntry>> {
    return this.q(c, 'GetAuditTrail', [startTime, endTime, pageSize, bookmark], AuditPage);
  }
  getPaymentsByInvoice(c: CallerIdentity, invoiceId: string): Promise<PaymentRecord[]> {
    return this.q(c, 'GetPaymentsByInvoice', [invoiceId], z.array(PaymentRecordSchema));
  }
  listPayments(c: CallerIdentity, pageSize: number, bookmark: string): Promise<Page<PaymentRecord>> {
    return this.q(c, 'ListPayments', [pageSize, bookmark], PaymentPage);
  }
  getClock(c: CallerIdentity): Promise<Clock> { return this.q(c, 'GetClock', [], ClockSchema); }
  getConfig(c: CallerIdentity): Promise<LedgerConfig> { return this.q(c, 'GetConfig', [], LedgerConfigSchema); }
}
