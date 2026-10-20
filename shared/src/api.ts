import { z } from 'zod';
import {
  AnomalyRecordSchema, AuditEntrySchema, BuyerScoreSchema, ExtractedInvoiceSchema, HistoryEntrySchema, HoldingSchema,
  InvoicePrivateDetailsSchema, InvoiceSchema, InvoiceStatusSchema, IsoDateSchema, KycStatusSchema, LineItemSchema,
  PaiseSchema, ParticipantSchema, PaymentRecordSchema, PlatformStatsSchema, PositivePaiseSchema, RoleSchema, pageOf,
} from './domain.js';
import { ERROR_CODES } from './errors.js';
import { EnvelopeEventSchema } from './events.js';

/** Standard error envelope for every non-2xx response. */
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string(), details: z.record(z.unknown()).optional() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const TxMetaSchema = z.object({ txId: z.string(), blockNumber: z.number().int(), timestamp: z.string() });
export type TxMeta = z.infer<typeof TxMetaSchema>;

export const PaginationQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  bookmark: z.string().default(''),
});

// ───────────── Auth ─────────────
export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  participantId: z.string(),
  mspId: z.string(),
  orgName: z.string(),
  vpa: z.string(),
  gstin: z.string().optional(),
  kycStatus: KycStatusSchema,
  frozen: z.boolean(),
  frozenReason: z.string().optional(),
  perInvoiceCapPaise: PaiseSchema,
  ledgerMode: z.enum(['mock', 'fabric', 'drunix']),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: RoleSchema.exclude(['OPERATOR', 'REGULATOR']),
  orgName: z.string().min(2),
  gstin: z.string().length(15).optional(),
  vpa: z.string().min(3).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenResponseSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), user: UserProfileSchema });
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const RefreshRequestSchema = z.object({ refreshToken: z.string() });

// ───────────── Invoices ─────────────
export const UploadResponseSchema = z.object({
  fileId: z.string(),
  fileHash: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  extraction: ExtractedInvoiceSchema,
  /** Resolved buyer participant (by GSTIN) if known on the platform */
  buyerId: z.string().nullable(),
  buyerName: z.string().nullable(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const CreateInvoiceRequestSchema = z.object({
  fileId: z.string(),
  buyerId: z.string().min(1),
  supplierGstin: z.string().length(15),
  buyerGstin: z.string().length(15),
  invoiceNumber: z.string().min(1),
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema,
  faceValuePaise: PositivePaiseSchema,
  taxAmountPaise: PaiseSchema.default(0),
  lineItems: z.array(LineItemSchema).min(1),
});
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

export const InvoiceWithMetaSchema = z.object({ invoice: InvoiceSchema, tx: TxMetaSchema });
export type InvoiceWithMeta = z.infer<typeof InvoiceWithMetaSchema>;

export const PricingPreviewSchema = z.object({
  unitFaceValuePaise: PaiseSchema, discountBps: z.number().int(), tenorDays: z.number().int(),
  discountPerUnitPaise: PaiseSchema, pricePerUnitPaise: PaiseSchema, yieldPerUnitPaise: PaiseSchema, annualizedYieldBps: z.number().int(),
});

export const InvoiceSummarySchema = InvoiceSchema.extend({
  supplierName: z.string(),
  buyerName: z.string(),
  buyerScore: z.number().int(),
  availableUnits: z.number().int(),
  reservedUnits: z.number().int(),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummarySchema>;

export const InvoiceDetailSchema = z.object({
  invoice: InvoiceSummarySchema,
  privateDetails: InvoicePrivateDetailsSchema.nullable(),
  privateAccess: z.enum(['GRANTED', 'DENIED_ORG', 'DENIED_PARTICIPANT']),
  pricing: PricingPreviewSchema.nullable(),
  buyerScore: BuyerScoreSchema,
  holdings: z.array(HoldingSchema),
  payments: z.array(PaymentRecordSchema),
  supplierPayoutElapsedSeconds: z.number().int().nullable(),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;

export const ListInvoicesQuerySchema = PaginationQuerySchema.extend({
  status: InvoiceStatusSchema.optional(),
  supplierId: z.string().optional(),
  buyerId: z.string().optional(),
  marketplace: z.coerce.boolean().optional(),
});
export const InvoiceListResponseSchema = pageOf(InvoiceSummarySchema);
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;

export const ListInvoiceRequestSchema = z.object({
  discountBps: z.number().int().min(1).max(10000),
  minFundingUnits: z.number().int().min(1),
});
export type ListInvoiceRequest = z.infer<typeof ListInvoiceRequestSchema>;

export const CancelInvoiceRequestSchema = z.object({ reason: z.string().min(1) });
export const InvoiceHistoryResponseSchema = z.object({ items: z.array(HistoryEntrySchema) });

// ───────────── UPI / Invest ─────────────
export const UpiStatusSchema = z.enum(['INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED', 'FAILED_LEDGER_REJECTED', 'REFUND_REQUIRED', 'REFUNDED']);
export type UpiStatus = z.infer<typeof UpiStatusSchema>;

export const UpiTransactionSchema = z.object({
  upiRef: z.string(),
  kind: z.enum(['FUNDING', 'BUYER_REPAYMENT', 'SUPPLIER_PAYOUT', 'INVESTOR_DISTRIBUTION', 'SUPPLIER_RESIDUAL', 'REFUND']),
  direction: z.enum(['IN', 'OUT']),
  status: UpiStatusSchema,
  amountPaise: PaiseSchema,
  invoiceId: z.string().nullable(),
  participantId: z.string().nullable(),
  payerVpa: z.string().nullable(),
  payeeVpa: z.string(),
  deeplink: z.string().nullable(),
  ledgerTxId: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type UpiTransaction = z.infer<typeof UpiTransactionSchema>;

export const InvestIntentRequestSchema = z.object({ units: z.number().int().min(1) });
export const PaymentIntentResponseSchema = z.object({
  upiRef: z.string(),
  amountPaise: PaiseSchema,
  units: z.number().int().optional(),
  deeplink: z.string(),
  qrDataUrl: z.string(),
  payeeVpa: z.string(),
  payeeName: z.string(),
  expiresAt: z.string(),
  status: UpiStatusSchema,
});
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;

export const UpiWebhookPayloadSchema = z.object({
  upiRef: z.string(),
  status: z.enum(['SUCCESS', 'FAILED']),
  amountPaise: PaiseSchema,
  payerVpa: z.string(),
  timestamp: z.string(),
  providerTxnId: z.string(),
});
export type UpiWebhookPayload = z.infer<typeof UpiWebhookPayloadSchema>;

export const WebhookResultSchema = z.object({
  upiRef: z.string(),
  status: UpiStatusSchema,
  replayed: z.boolean(),
  ledgerTxId: z.string().nullable(),
  errorCode: z.string().nullable(),
  message: z.string().optional(),
});
export type WebhookResult = z.infer<typeof WebhookResultSchema>;

export const PortfolioPositionSchema = z.object({
  invoiceId: z.string(),
  invoiceNumberMasked: z.string(),
  supplierName: z.string(),
  buyerName: z.string(),
  buyerScore: z.number().int(),
  status: InvoiceStatusSchema,
  units: z.number().int(),
  costPaise: PaiseSchema,
  expectedReturnPaise: PaiseSchema,
  expectedTotalPaise: PaiseSchema,
  realizedPaise: PaiseSchema,
  accruedYieldPaise: PaiseSchema,
  annualizedYieldBps: z.number().int(),
  dueDate: IsoDateSchema,
  tenorDays: z.number().int(),
  acquiredAt: z.string(),
  lossPaise: PaiseSchema,
});
export const PortfolioResponseSchema = z.object({
  positions: z.array(PortfolioPositionSchema),
  totals: z.object({
    investedPaise: PaiseSchema, expectedReturnPaise: PaiseSchema, realizedPaise: PaiseSchema,
    accruedYieldPaise: PaiseSchema, activePositions: z.number().int(), lossPaise: PaiseSchema,
  }),
});
export type PortfolioResponse = z.infer<typeof PortfolioResponseSchema>;

// ───────────── Settlement ─────────────
export const SupplierPayoutResponseSchema = z.object({
  invoice: InvoiceSchema, payment: PaymentRecordSchema, upi: UpiTransactionSchema, tx: TxMetaSchema,
});
export const RepaymentResponseSchema = z.object({
  invoice: InvoiceSchema, repayment: PaymentRecordSchema, distributions: z.array(PaymentRecordSchema),
  residual: PaymentRecordSchema.nullable(), buyerScore: BuyerScoreSchema, onTime: z.boolean(), tx: TxMetaSchema,
});
export const RepaymentRecordRequestSchema = z.object({ upiRef: z.string(), amountPaise: PositivePaiseSchema });

// ───────────── Platform ─────────────
export const StatsResponseSchema = PlatformStatsSchema.extend({
  ledgerMode: z.enum(['mock', 'fabric', 'drunix']),
  simulatedNow: z.string(),
  clockOffsetSeconds: z.number().int(),
  cachedAt: z.string(),
});
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

export const ScoreHistoryPointSchema = z.object({ timestamp: z.string(), score: z.number().int(), txId: z.string(), reason: z.string() });
export const ScoreResponseSchema = z.object({ score: BuyerScoreSchema, buyerName: z.string(), history: z.array(ScoreHistoryPointSchema) });
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>;

export const ReconciliationClassSchema = z.enum(['MATCHED', 'LEDGER_ONLY', 'UPI_ONLY', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'REFUND_REQUIRED']);
export const ReconciliationRowSchema = z.object({
  upiRef: z.string(),
  invoiceId: z.string().nullable(),
  kind: z.string(),
  ledgerAmountPaise: PaiseSchema.nullable(),
  upiAmountPaise: PaiseSchema.nullable(),
  ledgerStatus: z.string().nullable(),
  upiStatus: z.string().nullable(),
  classification: ReconciliationClassSchema,
  reason: z.string(),
});
export const ReconciliationResponseSchema = z.object({
  rows: z.array(ReconciliationRowSchema),
  summary: z.object({ total: z.number().int(), matched: z.number().int(), flagged: z.number().int() }),
  checkedAt: z.string(),
});
export type ReconciliationResponse = z.infer<typeof ReconciliationResponseSchema>;

export const AnomalyListResponseSchema = z.object({ items: z.array(AnomalyRecordSchema.extend({ guard: z.string() })), nextBookmark: z.string().nullable() });
export const AuditEventsQuerySchema = PaginationQuerySchema.extend({
  invoiceId: z.string().optional(), participantId: z.string().optional(), type: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(), format: z.enum(['json', 'csv']).default('json'),
});
export const AuditEventsResponseSchema = pageOf(EnvelopeEventSchema.extend({ seq: z.number().int() }));
export const AuditTrailResponseSchema = pageOf(AuditEntrySchema);

export const KycRequestSchema = z.object({ status: KycStatusSchema, kycDocHash: z.string().optional() });
export const FreezeRequestSchema = z.object({ frozen: z.boolean(), reason: z.string().optional() });
export const ParticipantWithUserSchema = ParticipantSchema.extend({ name: z.string(), email: z.string(), orgName: z.string() });
export const ParticipantListResponseSchema = z.object({ items: z.array(ParticipantWithUserSchema) });

export const NetworkTxSchema = z.object({
  txId: z.string(), blockNumber: z.number().int(), fn: z.string(), actorId: z.string(), actorRole: z.string(), timestamp: z.string(), invoiceId: z.string().optional(),
});
export const NetworkResponseSchema = z.object({
  ledgerMode: z.enum(['mock', 'fabric', 'drunix']), channel: z.string(), chaincode: z.string(), blockHeight: z.number().int(),
  healthy: z.boolean(), recent: z.array(NetworkTxSchema),
});
export type NetworkResponse = z.infer<typeof NetworkResponseSchema>;

// ───────────── Demo ─────────────
export const TimeTravelRequestSchema = z.object({ days: z.number().int().min(-365).max(3650).optional(), toInvoiceId: z.string().optional(), plusDays: z.number().int().optional() });
export const TimeTravelResponseSchema = z.object({ simulatedNow: z.string(), offsetSeconds: z.number().int(), tx: TxMetaSchema });
export const SimulatePaymentRequestSchema = z.object({ upiRef: z.string(), fail: z.boolean().optional() });
export const AttackRequestSchema = z.object({ variant: z.enum(['SAME_FILE', 'NEW_NUMBER', 'CHANGED_AMOUNT']) });
export const AttackResponseSchema = z.object({
  variant: z.string(), rejected: z.boolean(), errorCode: z.string().nullable(), message: z.string(),
  guard: z.string().nullable(), anomalyTxId: z.string().nullable(), targetInvoiceId: z.string().nullable(),
});
export type AttackResponse = z.infer<typeof AttackResponseSchema>;
export const SwitchRoleRequestSchema = z.object({ email: z.string().email().optional(), role: RoleSchema.optional() });
export const SeedResponseSchema = z.object({ ok: z.boolean(), ledgerMode: z.string(), users: z.number().int(), invoices: z.number().int(), durationMs: z.number().int() });
export const DemoStateResponseSchema = z.object({
  demoMode: z.boolean(), ledgerMode: z.enum(['mock', 'fabric', 'drunix']), simulatedNow: z.string(), offsetSeconds: z.number().int(),
  seeded: z.boolean(), lastCreatedInvoiceId: z.string().nullable(), pendingUpiRefs: z.array(z.string()), users: z.array(z.object({ email: z.string(), name: z.string(), role: RoleSchema, participantId: z.string() })),
});
export type DemoStateResponse = z.infer<typeof DemoStateResponseSchema>;
