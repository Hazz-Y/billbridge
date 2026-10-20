import {
  DEMO_USERS, computePricing, computeBuyerScore,
  type AnomalyRecord, type EnvelopeEvent, type Invoice, type InvoiceStatus, type InvoiceSummary, type Participant,
  type Role, type UserProfile, type NetworkResponse, type StatsResponse, type DemoStateResponse, type PortfolioResponse,
  type ReconciliationResponse, type InvoicePrivateDetails, type PaymentRecord, type Holding,
} from '@billbridge/shared';

/** Deterministic pseudo-sha256 (64 hex chars) for fixtures — NOT a real hash. */
export function fakeHash(seed: string): string {
  let h = 2166136261;
  let out = '';
  for (let i = 0; out.length < 64; i++) {
    const c = seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h ^ c, 16777619) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

export const NOW = '2026-10-20T09:30:00Z';
const UNIT = 100_000;

export function profileFor(role: Role): UserProfile {
  const u = DEMO_USERS.find((d) => d.role === role);
  if (!u) throw new Error('no demo user');
  return {
    id: `user-${u.participantId}`, email: u.email, name: u.name, role: u.role, participantId: u.participantId,
    mspId: role === 'BUYER' ? 'Org2MSP' : role === 'REGULATOR' ? 'Org3MSP' : 'Org1MSP', orgName: u.orgName, vpa: u.vpa,
    gstin: u.gstin, kycStatus: u.kycStatus, frozen: false, perInvoiceCapPaise: u.perInvoiceCapPaise, ledgerMode: 'mock',
  };
}

export function profileForEmail(email: string): UserProfile | null {
  const u = DEMO_USERS.find((d) => d.email === email);
  if (!u) return null;
  const p = profileFor(u.role);
  return { ...p, id: `user-${u.participantId}`, email: u.email, name: u.name, participantId: u.participantId, orgName: u.orgName, vpa: u.vpa, gstin: u.gstin, kycStatus: u.kycStatus, perInvoiceCapPaise: u.perInvoiceCapPaise };
}

interface Seed { n: number; supplierId: string; buyerId: string; face: number; status: InvoiceStatus; due: string; bps: number; sold: number; tenor: number }

const SEEDS: Seed[] = [
  { n: 1, supplierId: 'msme1', buyerId: 'buyer1', face: 40_000_000, status: 'DRAFT', due: '2026-12-26', bps: 0, sold: 0, tenor: 67 },
  { n: 2, supplierId: 'msme2', buyerId: 'buyer2', face: 25_000_000, status: 'BUYER_ACCEPTED', due: '2026-12-05', bps: 0, sold: 0, tenor: 46 },
  { n: 3, supplierId: 'msme1', buyerId: 'buyer3', face: 60_000_000, status: 'LISTED', due: '2026-12-19', bps: 900, sold: 0, tenor: 60 },
  { n: 4, supplierId: 'msme3', buyerId: 'buyer1', face: 30_000_000, status: 'PARTIALLY_FUNDED', due: '2026-11-29', bps: 800, sold: 120, tenor: 40 },
  { n: 5, supplierId: 'msme2', buyerId: 'buyer1', face: 50_000_000, status: 'FULLY_FUNDED', due: '2026-12-10', bps: 850, sold: 500, tenor: 51 },
  { n: 6, supplierId: 'msme1', buyerId: 'buyer1', face: 20_000_000, status: 'SUPPLIER_PAID', due: '2026-10-25', bps: 800, sold: 200, tenor: 30 },
  { n: 7, supplierId: 'msme3', buyerId: 'buyer3', face: 15_000_000, status: 'SETTLED', due: '2026-10-01', bps: 750, sold: 150, tenor: 45 },
  { n: 8, supplierId: 'msme2', buyerId: 'buyer2', face: 10_000_000, status: 'LATE', due: '2026-10-12', bps: 1000, sold: 100, tenor: 35 },
];

const NAME: Record<string, string> = Object.fromEntries(DEMO_USERS.map((u) => [u.participantId, u.name]));
const SCORE: Record<string, number> = { buyer1: computeBuyerScore(5, 2, 0), buyer2: computeBuyerScore(0, 0, 0), buyer3: computeBuyerScore(3, 0, 0) };

function invoiceFromSeed(s: Seed): InvoiceSummary {
  const pricing = s.bps > 0 ? computePricing(UNIT, s.bps, s.tenor) : null;
  const inv: Invoice = {
    invoiceId: fakeHash(`inv-${s.n}`), contentHash: fakeHash(`content-${s.n}`), supplierId: s.supplierId, buyerId: s.buyerId,
    faceValuePaise: s.face, issueDate: '2026-10-01', dueDate: s.due, unitFaceValuePaise: UNIT, discountBps: s.bps, tenorDays: s.bps ? s.tenor : 0,
    pricePerUnitPaise: pricing?.pricePerUnitPaise ?? 0, annualizedYieldBps: pricing?.annualizedYieldBps ?? 0,
    totalUnits: s.face / UNIT, unitsSold: s.sold, minFundingUnits: s.bps ? 50 : 0, status: s.status,
    listedAt: s.bps ? '2026-10-10T10:00:00Z' : undefined,
    fundedAt: ['FULLY_FUNDED', 'SUPPLIER_PAID', 'SETTLED', 'LATE'].includes(s.status) ? '2026-10-12T10:00:00Z' : undefined,
    supplierPaidAt: ['SUPPLIER_PAID', 'SETTLED', 'LATE'].includes(s.status) ? '2026-10-12T10:02:15Z' : undefined,
    settledAt: s.status === 'SETTLED' ? '2026-10-01T08:00:00Z' : undefined,
    createdAt: '2026-10-02T08:00:00Z', updatedAt: NOW, createdTxId: fakeHash(`tx-create-${s.n}`).slice(0, 64),
  };
  return {
    ...inv, supplierName: NAME[s.supplierId] ?? s.supplierId, buyerName: NAME[s.buyerId] ?? s.buyerId,
    buyerScore: SCORE[s.buyerId] ?? 50, availableUnits: inv.totalUnits - s.sold, reservedUnits: s.status === 'PARTIALLY_FUNDED' ? 10 : 0,
  };
}

export const INVOICES: InvoiceSummary[] = SEEDS.map(invoiceFromSeed);

export function privateDetailsFor(inv: InvoiceSummary, n: number): InvoicePrivateDetails {
  const base = inv.faceValuePaise - Math.trunc(inv.faceValuePaise * 18 / 118);
  return {
    invoiceId: inv.invoiceId, supplierGstin: '27AAACS1234A1ZX', buyerGstin: '27AABCA3456D1ZX', invoiceNumber: `INV-2026-00${n}`,
    lineItems: [
      { description: 'CNC machined aluminium housings', quantity: 400, unitPricePaise: Math.trunc(base / 2 / 400), totalPaise: Math.trunc(base / 2), hsnCode: '76169990' },
      { description: 'Inspection & packaging', quantity: 1, unitPricePaise: base - Math.trunc(base / 2), totalPaise: base - Math.trunc(base / 2), hsnCode: '998719' },
    ],
    fileHash: fakeHash(`file-${n}`), extractedJson: '',
  };
}

export function paymentsFor(inv: InvoiceSummary): PaymentRecord[] {
  const out: PaymentRecord[] = [];
  if (inv.unitsSold > 0) out.push({ upiRef: `UPI-F-${inv.invoiceId.slice(0, 6)}`, invoiceId: inv.invoiceId, kind: 'FUNDING', fromId: 'investor1', toId: 'platform', amountPaise: inv.unitsSold * inv.pricePerUnitPaise, timestamp: '2026-10-12T10:00:00Z', txId: fakeHash('tx-fund') });
  if (inv.supplierPaidAt) out.push({ upiRef: `UPI-P-${inv.invoiceId.slice(0, 6)}`, invoiceId: inv.invoiceId, kind: 'SUPPLIER_PAYOUT', fromId: 'platform', toId: inv.supplierId, amountPaise: inv.unitsSold * inv.pricePerUnitPaise, timestamp: inv.supplierPaidAt, txId: fakeHash('tx-payout') });
  if (inv.status === 'SETTLED') out.push({ upiRef: `UPI-R-${inv.invoiceId.slice(0, 6)}`, invoiceId: inv.invoiceId, kind: 'BUYER_REPAYMENT', fromId: inv.buyerId, toId: 'platform', amountPaise: inv.faceValuePaise, timestamp: '2026-10-01T08:00:00Z', txId: fakeHash('tx-repay') });
  return out;
}

export function holdingsFor(inv: InvoiceSummary): Holding[] {
  if (inv.unitsSold === 0) return [];
  return [{ invoiceId: inv.invoiceId, holderId: 'investor1', units: inv.unitsSold, costPaise: inv.unitsSold * inv.pricePerUnitPaise, upiRefs: [`UPI-F-${inv.invoiceId.slice(0, 6)}`], acquiredAt: '2026-10-12T10:00:00Z', receivedPaise: inv.status === 'SETTLED' ? inv.unitsSold * UNIT : 0 }];
}

export const STATS: StatsResponse = {
  totalInvoices: INVOICES.length, activeInvoices: 5, settledInvoices: 1, totalFundedPaise: 1_050 * 98_000, totalFaceValuePaise: INVOICES.reduce((a, i) => a + i.faceValuePaise, 0),
  activeInvestors: 4, avgYieldBps: 860, defaultRateBps: 0, blockHeight: 42, ledgerMode: 'mock', simulatedNow: NOW, clockOffsetSeconds: 0, cachedAt: NOW,
};

const FNS = ['CreateInvoice', 'AcceptInvoice', 'ListInvoice', 'Invest', 'ReleaseSupplierPayout', 'RecordRepayment', 'RecordAnomaly'];
export const EVENTS: Array<EnvelopeEvent & { seq: number }> = Array.from({ length: 20 }, (_, i) => {
  const fn = FNS[i % FNS.length] ?? 'Invest';
  const inv = INVOICES[i % INVOICES.length];
  return {
    seq: 23 + i, fn, txId: fakeHash(`tx-${i}`), blockNumber: 23 + i, timestamp: new Date(Date.parse(NOW) - (20 - i) * 90_000).toISOString(),
    actorId: fn === 'Invest' ? 'investor1' : fn === 'AcceptInvoice' ? 'buyer1' : 'operator1', actorRole: fn === 'Invest' ? 'INVESTOR' : fn === 'AcceptInvoice' ? 'BUYER' : 'OPERATOR',
    invoiceId: inv?.invoiceId, events: [{ type: fn === 'Invest' ? 'INVESTMENT_MADE' : 'INVOICE_STATUS_CHANGED', payload: { units: 50 } }],
  };
});

export const NETWORK: NetworkResponse = {
  ledgerMode: 'mock', channel: 'billbridge', chaincode: 'billbridge', blockHeight: 42, healthy: true,
  recent: EVENTS.slice(-20).reverse().map((e) => ({ txId: e.txId, blockNumber: e.blockNumber, fn: e.fn, actorId: e.actorId, actorRole: e.actorRole, timestamp: e.timestamp, invoiceId: e.invoiceId })),
};

export const ANOMALIES: Array<AnomalyRecord & { guard: string }> = [
  { anomalyId: 'anom-1', kind: 'DUPLICATE_FILE', guard: 'DUPLICATE_FILE', actorId: 'msme1', invoiceRef: INVOICES[0]?.invoiceId, errorCode: 'ERR_DUPLICATE_FILE', detail: 'Same PDF bytes already tokenized', recordedAt: '2026-10-19T12:00:00Z', txId: fakeHash('anom-1') },
  { anomalyId: 'anom-2', kind: 'DUPLICATE_CONTENT', guard: 'DUPLICATE_CONTENT', actorId: 'msme1', invoiceRef: INVOICES[0]?.invoiceId, errorCode: 'ERR_DUPLICATE_INVOICE_CONTENT', detail: 'Content fingerprint matches under a new invoice number', recordedAt: '2026-10-19T12:05:00Z', txId: fakeHash('anom-2') },
  { anomalyId: 'anom-3', kind: 'CAP_VIOLATION', guard: 'CAP_VIOLATION', actorId: 'investor4', invoiceRef: INVOICES[2]?.invoiceId, errorCode: 'ERR_CAP_EXCEEDED', detail: 'Cost exceeds per-invoice cap', recordedAt: '2026-10-19T13:00:00Z', txId: fakeHash('anom-3') },
];

export const PARTICIPANTS: Array<Participant & { name: string; email: string; orgName: string }> = DEMO_USERS.map((u) => ({
  id: u.participantId, role: u.role, orgMsp: u.role === 'BUYER' ? 'Org2MSP' : u.role === 'REGULATOR' ? 'Org3MSP' : 'Org1MSP', kycStatus: u.kycStatus,
  kycDocHash: fakeHash(`kyc-${u.participantId}`), perInvoiceCapPaise: u.perInvoiceCapPaise, frozen: u.participantId === 'investor4', frozenReason: u.participantId === 'investor4' ? 'Suspicious activity' : undefined,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: NOW, name: u.name, email: u.email, orgName: u.orgName,
}));

export const DEMO_STATE: DemoStateResponse = {
  demoMode: true, ledgerMode: 'mock', simulatedNow: NOW, offsetSeconds: 0, seeded: true, lastCreatedInvoiceId: INVOICES[0]?.invoiceId ?? null,
  pendingUpiRefs: ['UPI-MOCK-PENDING-1'], users: DEMO_USERS.map((u) => ({ email: u.email, name: u.name, role: u.role, participantId: u.participantId })),
};

export const PORTFOLIO: PortfolioResponse = (() => {
  const positions = INVOICES.filter((i) => i.unitsSold > 0).map((i) => {
    const cost = i.unitsSold * i.pricePerUnitPaise;
    const ret = i.unitsSold * (UNIT - i.pricePerUnitPaise);
    return {
      invoiceId: i.invoiceId, invoiceNumberMasked: `INV-••••-${i.invoiceId.slice(0, 3)}`, supplierName: i.supplierName, buyerName: i.buyerName, buyerScore: i.buyerScore,
      status: i.status, units: i.unitsSold, costPaise: cost, expectedReturnPaise: ret, expectedTotalPaise: cost + ret,
      realizedPaise: i.status === 'SETTLED' ? cost + ret : 0, accruedYieldPaise: i.status === 'SETTLED' ? ret : Math.trunc(ret / 3), annualizedYieldBps: i.annualizedYieldBps,
      dueDate: i.dueDate, tenorDays: i.tenorDays, acquiredAt: '2026-10-12T10:00:00Z', lossPaise: 0,
    };
  });
  const sum = (k: 'costPaise' | 'expectedReturnPaise' | 'realizedPaise' | 'accruedYieldPaise' | 'lossPaise') => positions.reduce((a, p) => a + p[k], 0);
  return { positions, totals: { investedPaise: sum('costPaise'), expectedReturnPaise: sum('expectedReturnPaise'), realizedPaise: sum('realizedPaise'), accruedYieldPaise: sum('accruedYieldPaise'), activePositions: positions.filter((p) => p.status !== 'SETTLED').length, lossPaise: sum('lossPaise') } };
})();

export const RECONCILIATION: ReconciliationResponse = {
  rows: [
    { upiRef: 'UPI-F-1a2b3c', invoiceId: INVOICES[3]?.invoiceId ?? null, kind: 'FUNDING', ledgerAmountPaise: 11_760_000, upiAmountPaise: 11_760_000, ledgerStatus: 'RECORDED', upiStatus: 'SUCCESS', classification: 'MATCHED', reason: 'Amounts and statuses agree' },
    { upiRef: 'UPI-F-9z8y7x', invoiceId: INVOICES[2]?.invoiceId ?? null, kind: 'FUNDING', ledgerAmountPaise: null, upiAmountPaise: 4_900_000, ledgerStatus: null, upiStatus: 'SUCCESS', classification: 'UPI_ONLY', reason: 'UPI success without ledger record — refund required' },
    { upiRef: 'UPI-R-5d6e7f', invoiceId: INVOICES[6]?.invoiceId ?? null, kind: 'BUYER_REPAYMENT', ledgerAmountPaise: 15_000_000, upiAmountPaise: 14_990_000, ledgerStatus: 'RECORDED', upiStatus: 'SUCCESS', classification: 'AMOUNT_MISMATCH', reason: 'UPI amount differs by ₹100.00' },
  ],
  summary: { total: 3, matched: 1, flagged: 2 }, checkedAt: NOW,
};

export function scoreFor(buyerId: string) {
  const hist = DEMO_USERS.find((u) => u.participantId === buyerId)?.history ?? [0, 0, 0];
  const score = computeBuyerScore(hist[0], hist[1], hist[2]);
  return {
    score: { buyerId, settledOnTime: hist[0], settledLate: hist[1], defaulted: hist[2], score, lastUpdated: NOW }, buyerName: NAME[buyerId] ?? buyerId,
    history: [50, 67, 60, 63, score].map((s, i) => ({ timestamp: new Date(Date.parse(NOW) - (5 - i) * 7 * 86_400_000).toISOString(), score: s, txId: fakeHash(`score-${i}`), reason: i === 0 ? 'Initial' : i % 2 ? 'Settled late' : 'Settled on time' })),
  };
}
