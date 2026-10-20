import { makeGstin } from './gstin.js';
import type { Role } from './enums.js';

/** Seeded demo users (spec 7). All synthetic. Password for every account: Demo@1234 */
export const DEMO_PASSWORD = 'Demo@1234';

export interface DemoUser {
  email: string;
  name: string;
  role: Role;
  participantId: string;
  orgName: string;
  perInvoiceCapPaise: number;
  kycStatus: 'PENDING' | 'APPROVED';
  gstin?: string;
  vpa: string;
  /** Seeded buyer history (onTime, late, defaulted) via SeedBuyerHistory */
  history?: [number, number, number];
}

export const DEMO_GSTINS = {
  msme1: makeGstin('27AAACS1234A1Z'),
  msme2: makeGstin('33AABCK5678B1Z'),
  msme3: makeGstin('32AACCN9012C1Z'),
  buyer1: makeGstin('27AABCA3456D1Z'),
  buyer2: makeGstin('29AADCM7890E1Z'),
  buyer3: makeGstin('07AAECV2345F1Z'),
} as const;

export const DEMO_USERS: DemoUser[] = [
  { email: 'operator@demo.in', name: 'BillBridge Operations', role: 'OPERATOR', participantId: 'operator1', orgName: 'BillBridge Platform', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', vpa: 'billbridge@upi' },
  { email: 'regulator@demo.in', name: 'Sandbox Regulator', role: 'REGULATOR', participantId: 'regulator1', orgName: 'Regulatory Sandbox', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', vpa: 'regulator@upi' },
  { email: 'msme1@demo.in', name: 'Sharma Precision Components', role: 'MSME', participantId: 'msme1', orgName: 'Sharma Precision Components Pvt Ltd', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', gstin: DEMO_GSTINS.msme1, vpa: 'sharmaprecision@upi' },
  { email: 'msme2@demo.in', name: 'Kaveri Textiles', role: 'MSME', participantId: 'msme2', orgName: 'Kaveri Textiles', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', gstin: DEMO_GSTINS.msme2, vpa: 'kaveritextiles@upi' },
  { email: 'msme3@demo.in', name: 'Nila Packaging', role: 'MSME', participantId: 'msme3', orgName: 'Nila Packaging LLP', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', gstin: DEMO_GSTINS.msme3, vpa: 'nilapackaging@upi' },
  { email: 'buyer1@demo.in', name: 'Aurora Motors Ltd', role: 'BUYER', participantId: 'buyer1', orgName: 'Aurora Motors Ltd', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', gstin: DEMO_GSTINS.buyer1, vpa: 'auroramotors@upi', history: [5, 2, 0] },
  { email: 'buyer2@demo.in', name: 'Meridian Retail', role: 'BUYER', participantId: 'buyer2', orgName: 'Meridian Retail Pvt Ltd', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', gstin: DEMO_GSTINS.buyer2, vpa: 'meridianretail@upi', history: [0, 0, 0] },
  { email: 'buyer3@demo.in', name: 'Vertex Infra', role: 'BUYER', participantId: 'buyer3', orgName: 'Vertex Infra Ltd', perInvoiceCapPaise: 0, kycStatus: 'APPROVED', gstin: DEMO_GSTINS.buyer3, vpa: 'vertexinfra@upi', history: [3, 0, 0] },
  { email: 'investor1@demo.in', name: 'Priya Nair', role: 'INVESTOR', participantId: 'investor1', orgName: 'Individual', perInvoiceCapPaise: 50_000_000, kycStatus: 'APPROVED', vpa: 'priya.nair@upi' },
  { email: 'investor2@demo.in', name: 'Arjun Mehta', role: 'INVESTOR', participantId: 'investor2', orgName: 'Individual', perInvoiceCapPaise: 100_000_000, kycStatus: 'APPROVED', vpa: 'arjun.mehta@upi' },
  { email: 'investor3@demo.in', name: 'Deepa Iyer', role: 'INVESTOR', participantId: 'investor3', orgName: 'Individual', perInvoiceCapPaise: 20_000_000, kycStatus: 'APPROVED', vpa: 'deepa.iyer@upi' },
  { email: 'investor4@demo.in', name: 'Rohan Das', role: 'INVESTOR', participantId: 'investor4', orgName: 'Individual', perInvoiceCapPaise: 5_000_000, kycStatus: 'APPROVED', vpa: 'rohan.das@upi' },
  { email: 'investor5@demo.in', name: 'Ananya Rao', role: 'INVESTOR', participantId: 'investor5', orgName: 'Individual', perInvoiceCapPaise: 30_000_000, kycStatus: 'PENDING', vpa: 'ananya.rao@upi' },
  { email: 'investor6@demo.in', name: 'Vikram Singh', role: 'INVESTOR', participantId: 'investor6', orgName: 'Individual', perInvoiceCapPaise: 100_000_000, kycStatus: 'APPROVED', vpa: 'vikram.singh@upi' },
];

export const DEMO_USER_BY_ROLE: Record<Role, string> = {
  OPERATOR: 'operator@demo.in', REGULATOR: 'regulator@demo.in', MSME: 'msme1@demo.in', BUYER: 'buyer1@demo.in', INVESTOR: 'investor1@demo.in',
};

export function demoUser(participantId: string): DemoUser {
  const u = DEMO_USERS.find((x) => x.participantId === participantId);
  if (!u) throw new Error(`unknown demo user ${participantId}`);
  return u;
}

/** The live demo invoice (samples/invoice-aurora-001.pdf). NOT created by seed. */
export const DEMO_INVOICE = {
  invoiceNumber: 'INV-2025-001',
  supplierId: 'msme1',
  buyerId: 'buyer1',
  faceValuePaise: 40_000_000,
  taxAmountPaise: 6_101_700,
  tenorDaysFromToday: 67,
  discountBps: 800,
  lineItems: [
    // base 33,898,300 + GST 18% 6,101,700 = 40,000,000 paise (₹4,00,000)
    { description: 'CNC machined aluminium housings (grade 6061)', quantity: 400, unitPricePaise: 52_000, totalPaise: 20_800_000, hsnCode: '76169990' },
    { description: 'Precision steel shafts, 20mm', quantity: 1200, unitPricePaise: 7_500, totalPaise: 9_000_000, hsnCode: '73181500' },
    { description: 'Inspection & packaging', quantity: 1, unitPricePaise: 4_098_300, totalPaise: 4_098_300, hsnCode: '998719' },
  ],
} as const;

export const SANDBOX_BANNER = 'SANDBOX — Prototype · Synthetic data · Not investment advice';
