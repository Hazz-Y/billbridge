export const ROLES = ['MSME', 'INVESTOR', 'BUYER', 'OPERATOR', 'REGULATOR'] as const;
export type Role = (typeof ROLES)[number];

export const KYC_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const INVOICE_STATUSES = [
  'DRAFT', 'BUYER_ACCEPTED', 'LISTED', 'PARTIALLY_FUNDED', 'FULLY_FUNDED',
  'SUPPLIER_PAID', 'SETTLED', 'LATE', 'DEFAULTED', 'CANCELLED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_KINDS = ['FUNDING', 'SUPPLIER_PAYOUT', 'BUYER_REPAYMENT', 'INVESTOR_DISTRIBUTION', 'SUPPLIER_RESIDUAL'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const ANOMALY_KINDS = [
  'DUPLICATE_INVOICE_ID', 'DUPLICATE_CONTENT', 'DUPLICATE_FILE', 'KYC_VIOLATION',
  'CAP_VIOLATION', 'FROZEN_ACTOR_ATTEMPT', 'IDENTITY_MISMATCH', 'DEFAULT', 'OTHER',
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

/** Role -> Fabric MSP mapping (spec 5.5). */
export const ROLE_MSP: Record<Role, string> = {
  OPERATOR: 'Org1MSP', MSME: 'Org1MSP', INVESTOR: 'Org1MSP', BUYER: 'Org2MSP', REGULATOR: 'Org3MSP',
};
export const MSP_ORG_NAME: Record<string, string> = {
  Org1MSP: 'Platform Org', Org2MSP: 'Corporate Org', Org3MSP: 'Regulator Org',
};

/** Legal invoice transitions (spec 4.5). Anything else -> ERR_INVALID_TRANSITION. */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ['BUYER_ACCEPTED', 'CANCELLED'],
  BUYER_ACCEPTED: ['LISTED'],
  LISTED: ['PARTIALLY_FUNDED', 'FULLY_FUNDED', 'CANCELLED'],
  PARTIALLY_FUNDED: ['PARTIALLY_FUNDED', 'FULLY_FUNDED', 'SUPPLIER_PAID'],
  FULLY_FUNDED: ['SUPPLIER_PAID'],
  SUPPLIER_PAID: ['SETTLED', 'LATE', 'DEFAULTED'],
  LATE: ['SETTLED', 'DEFAULTED'],
  SETTLED: [],
  DEFAULTED: [],
  CANCELLED: [],
};

export const PIPELINE_STAGES: readonly { key: string; label: string; statuses: readonly InvoiceStatus[] }[] = [
  { key: 'draft', label: 'Draft', statuses: ['DRAFT'] },
  { key: 'accepted', label: 'Accepted', statuses: ['BUYER_ACCEPTED'] },
  { key: 'listed', label: 'Listed', statuses: ['LISTED', 'PARTIALLY_FUNDED'] },
  { key: 'funded', label: 'Funded', statuses: ['FULLY_FUNDED'] },
  { key: 'paid', label: 'Paid', statuses: ['SUPPLIER_PAID', 'LATE'] },
  { key: 'settled', label: 'Settled', statuses: ['SETTLED', 'DEFAULTED'] },
];
