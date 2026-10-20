/**
 * Demo seed: all DEMO_USERS (+ ledger participants, KYC, buyer history) and 8 invoices driven through the REAL ledger flows
 * with back-dated tx timestamps. Idempotent (app_state.seededAt). Never creates INV-2025-001 (the live demo invoice).
 */
import { DEMO_PASSWORD, DEMO_USERS, LedgerError, ROLE_MSP, SeedResponseSchema, addDays, type DemoUser, type LineItem } from '@billbridge/shared';
import type { z } from 'zod';

export type SeedResponse = z.infer<typeof SeedResponseSchema>;
import { sha256Hex } from '@billbridge/shared/hashing';
import { hashPassword } from '../auth/service.js';
import type { AppContext } from '../context.js';
import { getState, setState, wipeDb } from '../db.js';
import { callerFor, operatorCaller } from '../ledger/identity.js';
import { distributionPayouts } from '../services/payments.js';
import { invalidateStats } from '../services/platform.js';
import { recordPayout } from '../upi/service.js';

export const STATE_SEEDED_AT = 'seededAt';

type Target = 'DRAFT' | 'BUYER_ACCEPTED' | 'LISTED' | 'PARTIALLY_FUNDED' | 'FULLY_FUNDED' | 'SUPPLIER_PAID' | 'SETTLED' | 'LATE';
interface SeedInvoice {
  n: number; supplier: string; buyer: string; number: string; facePaise: number; target: Target; discountBps: number; minUnits: number;
  issueOffsetDays: number; dueOffsetDays: number; txOffsetDays: number; investors: Array<[string, number]>; description: string;
}

const PLAN: SeedInvoice[] = [
  { n: 1, supplier: 'msme2', buyer: 'buyer2', number: 'INV-2025-101', facePaise: 30_000_000, target: 'DRAFT', discountBps: 900, minUnits: 10, issueOffsetDays: -2, dueOffsetDays: 58, txOffsetDays: -1, investors: [], description: 'Cotton shirting fabric, 60s combed' },
  { n: 2, supplier: 'msme3', buyer: 'buyer3', number: 'INV-2025-102', facePaise: 15_000_000, target: 'BUYER_ACCEPTED', discountBps: 1000, minUnits: 5, issueOffsetDays: -4, dueOffsetDays: 41, txOffsetDays: -3, investors: [], description: 'Corrugated shipping cartons 5-ply' },
  { n: 3, supplier: 'msme1', buyer: 'buyer2', number: 'INV-2025-103', facePaise: 50_000_000, target: 'LISTED', discountBps: 900, minUnits: 50, issueOffsetDays: -6, dueOffsetDays: 60, txOffsetDays: -5, investors: [], description: 'Brass fittings assorted, machined' },
  { n: 4, supplier: 'msme2', buyer: 'buyer1', number: 'INV-2025-104', facePaise: 25_000_000, target: 'PARTIALLY_FUNDED', discountBps: 800, minUnits: 50, issueOffsetDays: -9, dueOffsetDays: 51, txOffsetDays: -8, investors: [['investor2', 100]], description: 'Seat upholstery fabric, automotive grade' },
  { n: 5, supplier: 'msme3', buyer: 'buyer2', number: 'INV-2025-105', facePaise: 20_000_000, target: 'FULLY_FUNDED', discountBps: 1100, minUnits: 50, issueOffsetDays: -12, dueOffsetDays: 48, txOffsetDays: -11, investors: [['investor2', 120], ['investor3', 80]], description: 'Retail display packaging, printed' },
  { n: 6, supplier: 'msme1', buyer: 'buyer3', number: 'INV-2025-106', facePaise: 40_000_000, target: 'SUPPLIER_PAID', discountBps: 850, minUnits: 200, issueOffsetDays: -35, dueOffsetDays: 5, txOffsetDays: -30, investors: [['investor1', 150], ['investor2', 200]], description: 'Structural steel brackets, galvanised' },
  { n: 7, supplier: 'msme2', buyer: 'buyer3', number: 'INV-2025-107', facePaise: 80_000_000, target: 'SETTLED', discountBps: 700, minUnits: 400, issueOffsetDays: -55, dueOffsetDays: -3, txOffsetDays: -50, investors: [['investor2', 300], ['investor6', 300], ['investor3', 50]], description: 'Site-worker uniforms, 12,000 sets' },
  { n: 8, supplier: 'msme3', buyer: 'buyer2', number: 'INV-2025-108', facePaise: 35_000_000, target: 'LATE', discountBps: 1200, minUnits: 100, issueOffsetDays: -80, dueOffsetDays: -20, txOffsetDays: -70, investors: [['investor1', 100], ['investor6', 150]], description: 'Festival gift boxes, foil stamped' },
];

const isoAt = (date: string, hhmm = '10:00') => `${date}T${hhmm}:00Z`;

function lineItemsFor(facePaise: number, description: string): { lineItems: LineItem[]; taxPaise: number } {
  const base = Math.round((facePaise * 100) / 118);
  const taxPaise = facePaise - base;
  const a = Math.floor(base * 0.6);
  const b = base - a;
  return { lineItems: [{ description, quantity: 1, unitPricePaise: a, totalPaise: a, hsnCode: '998719' }, { description: `${description} - freight & handling`, quantity: 1, unitPricePaise: b, totalPaise: b, hsnCode: '996511' }], taxPaise };
}

export async function seedUsers(ctx: AppContext): Promise<number> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const op = operatorCaller();
  let count = 0;
  for (const u of DEMO_USERS) {
    await ensureParticipant(ctx, u);
    const existing = await ctx.db.user.findUnique({ where: { email: u.email } });
    if (!existing) {
      await ctx.db.user.create({ data: { email: u.email, passwordHash, name: u.name, role: u.role, participantId: u.participantId, mspId: ROLE_MSP[u.role], orgName: u.orgName, vpa: u.vpa, gstin: u.gstin ?? null } });
    }
    count++;
  }
  for (const u of DEMO_USERS) {
    if (u.role === 'BUYER' && u.history) {
      const [onTime, late, defaulted] = u.history;
      const current = await ctx.ledger.getBuyerScore(op, u.participantId);
      if (current.settledOnTime === 0 && current.settledLate === 0 && current.defaulted === 0 && onTime + late + defaulted > 0) {
        await ctx.ledger.seedBuyerHistory(op, u.participantId, onTime, late, defaulted);
      }
    }
  }
  return count;
}

async function ensureParticipant(ctx: AppContext, u: DemoUser): Promise<void> {
  const op = operatorCaller();
  try {
    await ctx.ledger.getParticipant(op, u.participantId);
  } catch (e) {
    if (!(e instanceof LedgerError && e.code === 'ERR_PARTICIPANT_NOT_FOUND')) throw e;
    await ctx.ledger.registerParticipant(op, u.participantId, u.role, ROLE_MSP[u.role], u.perInvoiceCapPaise);
  }
  const p = await ctx.ledger.getParticipant(op, u.participantId);
  if (u.kycStatus === 'APPROVED' && p.kycStatus !== 'APPROVED' && u.participantId !== 'operator1') {
    await ctx.ledger.setKycStatus(op, u.participantId, 'APPROVED', sha256Hex(`kyc-${u.participantId}`));
  }
}

export async function seedInvoices(ctx: AppContext): Promise<number> {
  const op = operatorCaller();
  const gstinOf = (pid: string) => DEMO_USERS.find((u) => u.participantId === pid)?.gstin ?? '';
  const vpaOf = (pid: string) => DEMO_USERS.find((u) => u.participantId === pid)?.vpa ?? `${pid}@upi`;
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  for (const s of PLAN) {
    const supplier = callerFor({ role: 'MSME', participantId: s.supplier });
    const buyer = callerFor({ role: 'BUYER', participantId: s.buyer });
    const issueDate = addDays(today, s.issueOffsetDays);
    const dueDate = addDays(today, s.dueOffsetDays);
    const t0 = addDays(today, s.txOffsetDays);
    const { lineItems } = lineItemsFor(s.facePaise, s.description);
    const fileHash = sha256Hex(`seed-${s.n}`);
    let invoiceId: string;
    try {
      const r = await ctx.ledger.createInvoice(supplier, s.supplier, s.buyer, s.facePaise, issueDate, dueDate,
        { supplierGstin: gstinOf(s.supplier), buyerGstin: gstinOf(s.buyer), invoiceNumber: s.number, lineItems, fileHash, extractedJson: '' }, { txTimestamp: isoAt(t0, '09:00') });
      invoiceId = r.data.invoiceId;
      created++;
    } catch (e) {
      if (e instanceof LedgerError && e.code === 'ERR_DUPLICATE_INVOICE_ID') continue; // already seeded
      throw e;
    }
    if (s.target === 'DRAFT') continue;
    await ctx.ledger.buyerAcceptInvoice(buyer, invoiceId, { txTimestamp: isoAt(t0, '11:00') });
    if (s.target === 'BUYER_ACCEPTED') continue;
    const listed = await ctx.ledger.listInvoice(op, invoiceId, s.discountBps, s.minUnits, { txTimestamp: isoAt(addDays(t0, 1), '10:00') });
    if (s.target === 'LISTED') continue;
    let k = 0;
    for (const [investorId, units] of s.investors) {
      k++;
      const investor = callerFor({ role: 'INVESTOR', participantId: investorId });
      const upiRef = `SEED-F-${s.n}${k}`;
      const r = await ctx.ledger.invest(investor, invoiceId, investorId, units, upiRef, { txTimestamp: isoAt(addDays(t0, 1 + k), '12:00') });
      const existing = await ctx.db.upiTransaction.findUnique({ where: { upiRef } });
      if (!existing) {
        await ctx.db.upiTransaction.create({
          data: { upiRef, kind: 'FUNDING', direction: 'IN', status: 'SUCCESS', amountPaise: units * listed.data.pricePerUnitPaise, invoiceId, participantId: investorId, payerVpa: vpaOf(investorId), payeeVpa: ctx.config.upi.platformVpa, units, ledgerTxId: r.txId, providerTxnId: `SIMSEED${s.n}${k}` },
        });
      }
    }
    if (s.target === 'PARTIALLY_FUNDED' || s.target === 'FULLY_FUNDED') continue;
    const payoutRef = `SEED-P-${s.n}`;
    const rel = await ctx.ledger.releaseToSupplier(op, invoiceId, payoutRef, { txTimestamp: isoAt(addDays(t0, 2 + s.investors.length), '14:00') });
    await recordPayout(ctx.db, ctx.upi, { upiRef: payoutRef, amountPaise: rel.data.payment.amountPaise, payeeVpa: vpaOf(s.supplier), participantId: s.supplier, kind: 'SUPPLIER_PAYOUT', invoiceId, ledgerTxId: rel.txId });
    if (s.target === 'SUPPLIER_PAID') continue;
    if (s.target === 'SETTLED') {
      const repayRef = `SEED-R-${s.n}`;
      const repayTs = isoAt(addDays(dueDate, -1), '15:00');
      const rep = await ctx.ledger.recordRepayment(op, invoiceId, repayRef, s.facePaise, { txTimestamp: repayTs });
      await ctx.db.upiTransaction.create({
        data: { upiRef: repayRef, kind: 'BUYER_REPAYMENT', direction: 'IN', status: 'SUCCESS', amountPaise: s.facePaise, invoiceId, participantId: s.buyer, payerVpa: vpaOf(s.buyer), payeeVpa: ctx.config.upi.platformVpa, ledgerTxId: rep.txId, providerTxnId: `SIMSEED${s.n}R` },
      });
      await distributionPayouts(ctx, rep.data, rep.txId);
      continue;
    }
    if (s.target === 'LATE') {
      await ctx.ledger.markLate(op, invoiceId, { txTimestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
    }
  }
  return created;
}

export async function seed(ctx: AppContext): Promise<SeedResponse> {
  const t0 = Date.now();
  const already = await getState(ctx.db, STATE_SEEDED_AT);
  if (already) {
    const users = await ctx.db.user.count();
    return { ok: true, ledgerMode: ctx.ledgerMode, users, invoices: PLAN.length, durationMs: Date.now() - t0 };
  }
  await ctx.ledgerBundle.init();
  const users = await seedUsers(ctx);
  const invoices = await seedInvoices(ctx);
  await ctx.events.flush();
  await ctx.events.backfill();
  await setState(ctx.db, STATE_SEEDED_AT, new Date().toISOString());
  invalidateStats();
  ctx.log.info({ users, invoices, durationMs: Date.now() - t0 }, 'demo data seeded');
  return { ok: true, ledgerMode: ctx.ledgerMode, users, invoices, durationMs: Date.now() - t0 };
}

export async function resetAndSeed(ctx: AppContext): Promise<SeedResponse> {
  const t0 = Date.now();
  await ctx.ledgerClient.reset();
  await wipeDb(ctx.db);
  invalidateStats();
  const r = await seed(ctx);
  return { ...r, durationMs: Date.now() - t0 };
}
