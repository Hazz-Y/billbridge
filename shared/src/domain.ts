import { z } from 'zod';
import { ANOMALY_KINDS, INVOICE_STATUSES, KYC_STATUSES, PAYMENT_KINDS, ROLES } from './enums.js';

export const PaiseSchema = z.number().int().nonnegative().refine((n) => Number.isSafeInteger(n), 'must be a safe integer');
export const PositivePaiseSchema = PaiseSchema.refine((n) => n > 0, 'must be > 0');
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const IsoTimestampSchema = z.string().min(1);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 hex');
export const RoleSchema = z.enum(ROLES);
export const KycStatusSchema = z.enum(KYC_STATUSES);
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export const PaymentKindSchema = z.enum(PAYMENT_KINDS);
export const AnomalyKindSchema = z.enum(ANOMALY_KINDS);

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  orgMsp: z.string().min(1),
  kycStatus: KycStatusSchema,
  kycDocHash: z.string(),
  perInvoiceCapPaise: PaiseSchema,
  frozen: z.boolean(),
  frozenReason: z.string().optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const InvoiceSchema = z.object({
  invoiceId: Sha256Schema,
  contentHash: Sha256Schema,
  supplierId: z.string().min(1),
  buyerId: z.string().min(1),
  faceValuePaise: PositivePaiseSchema,
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema,
  unitFaceValuePaise: PositivePaiseSchema,
  discountBps: z.number().int().nonnegative(),
  tenorDays: z.number().int().nonnegative(),
  pricePerUnitPaise: PaiseSchema,
  annualizedYieldBps: z.number().int().nonnegative(),
  totalUnits: z.number().int().positive(),
  unitsSold: z.number().int().nonnegative(),
  minFundingUnits: z.number().int().nonnegative(),
  status: InvoiceStatusSchema,
  listedAt: IsoTimestampSchema.optional(),
  fundedAt: IsoTimestampSchema.optional(),
  supplierPaidAt: IsoTimestampSchema.optional(),
  settledAt: IsoTimestampSchema.optional(),
  cancelReason: z.string().optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  createdTxId: z.string().optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const HoldingSchema = z.object({
  invoiceId: Sha256Schema,
  holderId: z.string().min(1),
  units: z.number().int().nonnegative(),
  costPaise: PaiseSchema,
  upiRefs: z.array(z.string()),
  acquiredAt: IsoTimestampSchema,
  receivedPaise: PaiseSchema,
  lossPaise: PaiseSchema.optional(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const PaymentRecordSchema = z.object({
  upiRef: z.string().min(1),
  invoiceId: Sha256Schema,
  kind: PaymentKindSchema,
  fromId: z.string(),
  toId: z.string(),
  amountPaise: PaiseSchema,
  timestamp: IsoTimestampSchema,
  txId: z.string().optional(),
});
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

export const BuyerScoreSchema = z.object({
  buyerId: z.string().min(1),
  settledOnTime: z.number().int().nonnegative(),
  settledLate: z.number().int().nonnegative(),
  defaulted: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  lastUpdated: IsoTimestampSchema,
});
export type BuyerScore = z.infer<typeof BuyerScoreSchema>;

export const AnomalyRecordSchema = z.object({
  anomalyId: z.string().min(1),
  kind: AnomalyKindSchema,
  actorId: z.string(),
  invoiceRef: z.string().optional(),
  errorCode: z.string(),
  detail: z.string(),
  recordedAt: IsoTimestampSchema,
  txId: z.string().optional(),
});
export type AnomalyRecord = z.infer<typeof AnomalyRecordSchema>;

export const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  unitPricePaise: PaiseSchema,
  totalPaise: PaiseSchema,
  hsnCode: z.string().optional(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const InvoicePrivateDetailsSchema = z.object({
  invoiceId: Sha256Schema.optional(),
  supplierGstin: z.string().length(15),
  buyerGstin: z.string().length(15),
  invoiceNumber: z.string().min(1),
  lineItems: z.array(LineItemSchema),
  fileHash: Sha256Schema,
  extractedJson: z.string().default(''),
});
export type InvoicePrivateDetails = z.infer<typeof InvoicePrivateDetailsSchema>;

export const ExtractedInvoiceSchema = z.object({
  supplierGstin: z.string(),
  buyerGstin: z.string(),
  supplierName: z.string().optional(),
  buyerName: z.string().optional(),
  invoiceNumber: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  lineItems: z.array(LineItemSchema),
  totalAmountPaise: PaiseSchema,
  taxAmountPaise: PaiseSchema,
  confidence: z.number().int().min(0).max(100),
  fieldConfidence: z.record(z.number().int().min(0).max(100)),
  warnings: z.array(z.string()),
  source: z.enum(['GEMINI', 'FALLBACK']),
});
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

export const PlatformStatsSchema = z.object({
  totalInvoices: z.number().int(),
  activeInvoices: z.number().int(),
  settledInvoices: z.number().int(),
  totalFundedPaise: PaiseSchema,
  totalFaceValuePaise: PaiseSchema,
  activeInvestors: z.number().int(),
  avgYieldBps: z.number().int(),
  defaultRateBps: z.number().int(),
  blockHeight: z.number().int(),
});
export type PlatformStats = z.infer<typeof PlatformStatsSchema>;

export const HistoryEntrySchema = z.object({
  txId: z.string(),
  timestamp: IsoTimestampSchema,
  isDelete: z.boolean(),
  blockNumber: z.number().int().optional(),
  fn: z.string().optional(),
  actorId: z.string().optional(),
  value: InvoiceSchema.nullable(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const AuditEntrySchema = z.object({
  txId: z.string(),
  blockNumber: z.number().int(),
  timestamp: IsoTimestampSchema,
  fn: z.string(),
  actorId: z.string(),
  actorRole: z.string(),
  invoiceId: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const LedgerConfigSchema = z.object({
  unitFaceValuePaise: PositivePaiseSchema,
  graceDays: z.number().int().nonnegative(),
  defaultDays: z.number().int().nonnegative(),
  demoMode: z.boolean(),
  minDiscountBps: z.number().int().nonnegative(),
  maxDiscountBps: z.number().int().nonnegative(),
  bootstrapOperatorId: z.string().min(1),
});
export type LedgerConfig = z.infer<typeof LedgerConfigSchema>;

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  unitFaceValuePaise: 100000, graceDays: 7, defaultDays: 90, demoMode: true,
  minDiscountBps: 100, maxDiscountBps: 3000, bootstrapOperatorId: 'operator1',
};

export function pageOf<T>(item: z.ZodType<T>) {
  return z.object({ items: z.array(item), nextBookmark: z.string().nullable() });
}
export interface Page<T> { items: T[]; nextBookmark: string | null }
