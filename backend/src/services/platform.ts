/** Portfolio, stats (cached), scores, reconciliation, participants, network. */
import {
  accruedYieldPaise, daysBetween, type AnomalyRecord, type NetworkResponse, type PaymentRecord, type PortfolioResponse, type ReconciliationResponse,
  type ScoreResponse, type StatsResponse,
} from '@billbridge/shared';
import type { AuthUser } from '../auth/hooks.js';
import type { AppContext } from '../context.js';
import { callerFor, operatorCaller } from '../ledger/identity.js';
import { withGuard } from './anomaly.js';
import { UserDirectory } from './users.js';

// ───────────── portfolio ─────────────
export async function portfolio(ctx: AppContext, investor: AuthUser): Promise<PortfolioResponse> {
  const caller = callerFor(investor);
  const holdings = await ctx.ledger.getHoldingsByInvestor(caller, investor.participantId);
  const clock = await ctx.ledger.getClock(caller);
  const dir = new UserDirectory(ctx);
  const positions: PortfolioResponse['positions'] = [];
  for (const h of holdings) {
    const inv = await ctx.ledger.getInvoice(caller, h.invoiceId);
    const score = await ctx.ledger.getBuyerScore(caller, inv.buyerId);
    const expectedReturnPaise = h.units * (inv.unitFaceValuePaise - inv.pricePerUnitPaise);
    const elapsed = daysBetween(h.acquiredAt, clock.now);
    const settled = inv.status === 'SETTLED' || inv.status === 'DEFAULTED';
    positions.push({
      invoiceId: h.invoiceId,
      invoiceNumberMasked: `INV-…${h.invoiceId.slice(0, 6)}`,
      supplierName: await dir.name(inv.supplierId),
      buyerName: await dir.name(inv.buyerId),
      buyerScore: score.score,
      status: inv.status,
      units: h.units,
      costPaise: h.costPaise,
      expectedReturnPaise,
      expectedTotalPaise: h.units * inv.unitFaceValuePaise,
      realizedPaise: h.receivedPaise,
      accruedYieldPaise: settled ? Math.max(0, h.receivedPaise - h.costPaise) : accruedYieldPaise(expectedReturnPaise, elapsed, Math.max(1, inv.tenorDays)),
      annualizedYieldBps: inv.annualizedYieldBps,
      dueDate: inv.dueDate,
      tenorDays: inv.tenorDays,
      acquiredAt: h.acquiredAt,
      lossPaise: h.lossPaise ?? 0,
    });
  }
  const totals = positions.reduce((t, p) => ({
    investedPaise: t.investedPaise + p.costPaise, expectedReturnPaise: t.expectedReturnPaise + p.expectedReturnPaise, realizedPaise: t.realizedPaise + p.realizedPaise,
    accruedYieldPaise: t.accruedYieldPaise + p.accruedYieldPaise, activePositions: t.activePositions + (p.status === 'SETTLED' || p.status === 'DEFAULTED' ? 0 : 1), lossPaise: t.lossPaise + p.lossPaise,
  }), { investedPaise: 0, expectedReturnPaise: 0, realizedPaise: 0, accruedYieldPaise: 0, activePositions: 0, lossPaise: 0 });
  return { positions, totals };
}

// ───────────── stats (cached) ─────────────
let statsCache: { at: number; version: number; value: StatsResponse } | null = null;
export function invalidateStats(): void { statsCache = null; }

export async function stats(ctx: AppContext): Promise<StatsResponse> {
  const now = Date.now();
  if (statsCache && now - statsCache.at < ctx.config.statsCacheMs && statsCache.version === ctx.events.version) return statsCache.value;
  const caller = operatorCaller();
  const [s, clock] = await Promise.all([ctx.ledger.getPlatformStats(caller), ctx.ledger.getClock(caller)]);
  const value: StatsResponse = { ...s, ledgerMode: ctx.ledgerMode, simulatedNow: clock.now, clockOffsetSeconds: clock.offsetSeconds, cachedAt: new Date(now).toISOString() };
  statsCache = { at: now, version: ctx.events.version, value };
  return value;
}

// ───────────── scores ─────────────
export async function scoreFor(ctx: AppContext, user: AuthUser, buyerId: string): Promise<ScoreResponse> {
  const score = await ctx.ledger.getBuyerScore(callerFor(user), buyerId);
  const rows = await ctx.db.scoreHistory.findMany({ where: { buyerId }, orderBy: { id: 'asc' } });
  return {
    score, buyerName: await new UserDirectory(ctx).name(buyerId),
    history: rows.map((r) => ({ timestamp: r.timestamp, score: r.score, txId: r.txId, reason: r.reason })),
  };
}

// ───────────── reconciliation ─────────────
const NO_LEDGER_EXPECTED = new Set(['INITIATED', 'PROCESSING', 'EXPIRED', 'FAILED']);

export async function reconciliation(ctx: AppContext): Promise<ReconciliationResponse> {
  const ledgerPayments = new Map<string, PaymentRecord>();
  let bookmark = '';
  for (let i = 0; i < 100; i++) {
    const page = await ctx.ledger.listPayments(operatorCaller(), 500, bookmark);
    for (const p of page.items) ledgerPayments.set(p.upiRef, p);
    if (!page.nextBookmark) break;
    bookmark = page.nextBookmark;
  }
  const upiRows = await ctx.db.upiTransaction.findMany({ orderBy: { createdAt: 'asc' } });
  const rows: ReconciliationResponse['rows'] = [];
  const seen = new Set<string>();
  for (const u of upiRows) {
    seen.add(u.upiRef);
    const l = ledgerPayments.get(u.upiRef);
    const base = { upiRef: u.upiRef, invoiceId: u.invoiceId ?? l?.invoiceId ?? null, kind: u.kind, ledgerAmountPaise: l?.amountPaise ?? null, upiAmountPaise: u.amountPaise, ledgerStatus: l ? 'RECORDED' : null, upiStatus: u.status };
    if (u.status === 'REFUND_REQUIRED' || u.status === 'FAILED_LEDGER_REJECTED') {
      rows.push({ ...base, classification: 'REFUND_REQUIRED', reason: `UPI money received but ledger rejected (${u.errorCode ?? 'unknown'}); refund ${u.upiRef}-X` });
    } else if (!l) {
      if (NO_LEDGER_EXPECTED.has(u.status)) rows.push({ ...base, classification: 'MATCHED', reason: `no ledger record expected for status ${u.status}` });
      else if (u.kind === 'REFUND') rows.push({ ...base, classification: 'MATCHED', reason: 'refund payout (off-chain by design)' });
      else rows.push({ ...base, classification: 'UPI_ONLY', reason: `UPI ${u.status} but no ledger payment record` });
    } else if (l.amountPaise !== u.amountPaise) {
      rows.push({ ...base, classification: 'AMOUNT_MISMATCH', reason: `ledger ${l.amountPaise} paise vs UPI ${u.amountPaise} paise${u.errorCode === 'INJECTED' ? ' (injected for demo)' : ''}` });
    } else if (u.status !== 'SUCCESS') {
      rows.push({ ...base, classification: 'STATUS_MISMATCH', reason: `ledger recorded payment but UPI status is ${u.status}` });
    } else rows.push({ ...base, classification: 'MATCHED', reason: 'amount and status agree' });
  }
  for (const [ref, l] of ledgerPayments) {
    if (seen.has(ref)) continue;
    rows.push({ upiRef: ref, invoiceId: l.invoiceId, kind: l.kind, ledgerAmountPaise: l.amountPaise, upiAmountPaise: null, ledgerStatus: 'RECORDED', upiStatus: null, classification: 'LEDGER_ONLY', reason: 'ledger payment without a UPI transaction row' });
  }
  const matched = rows.filter((r) => r.classification === 'MATCHED').length;
  return { rows, summary: { total: rows.length, matched, flagged: rows.length - matched }, checkedAt: new Date().toISOString() };
}

// ───────────── anomalies ─────────────
export async function anomalies(ctx: AppContext, user: AuthUser, pageSize: number, bookmark: string) {
  const page = await ctx.ledger.getAnomalies(callerFor(user), pageSize, bookmark);
  const ids = new Set(page.items.map((a) => a.anomalyId));
  const items = page.items.map(withGuard);
  if (!bookmark) {
    // local-only rows (ledger write failed) are appended so nothing is silently lost
    const local = await ctx.db.anomaly.findMany({ where: { anomalyId: null }, orderBy: { createdAt: 'desc' } });
    for (const l of local) {
      const rec: AnomalyRecord = { anomalyId: `local-${l.id}`, kind: l.kind as AnomalyRecord['kind'], actorId: l.actorId, ...(l.invoiceRef ? { invoiceRef: l.invoiceRef } : {}), errorCode: l.errorCode, detail: l.detail, recordedAt: l.createdAt.toISOString() };
      if (!ids.has(rec.anomalyId)) items.push(withGuard(rec));
    }
  }
  return { items, nextBookmark: page.nextBookmark };
}

// ───────────── participants ─────────────
export async function participants(ctx: AppContext, user: AuthUser) {
  const out = [];
  let bookmark = '';
  const dir = new UserDirectory(ctx);
  for (let i = 0; i < 50; i++) {
    const page = await ctx.ledger.listParticipants(callerFor(user), 500, bookmark);
    for (const p of page.items) {
      const u = await dir.byParticipant(p.id);
      out.push({ ...p, name: u?.name ?? p.id, email: u?.email ?? '', orgName: u?.orgName ?? '' });
    }
    if (!page.nextBookmark) break;
    bookmark = page.nextBookmark;
  }
  return { items: out };
}

// ───────────── network ─────────────
export async function network(ctx: AppContext): Promise<NetworkResponse> {
  const health = await ctx.ledgerClient.health();
  const recent = (await ctx.ledgerClient.recentEvents(20)).reverse().map((e) => ({
    txId: e.txId, blockNumber: e.blockNumber, fn: e.fn, actorId: e.actorId, actorRole: e.actorRole, timestamp: e.timestamp, ...(e.invoiceId ? { invoiceId: e.invoiceId } : {}),
  }));
  return { ledgerMode: ctx.ledgerMode, channel: health.channel, chaincode: health.chaincode, blockHeight: health.blockHeight, healthy: health.ok, recent };
}
