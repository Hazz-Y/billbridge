/** UPI <-> ledger orchestration: invest intents, webhook processing, supplier payouts, repayments. */
import {
  LedgerError, type PaymentIntentResponse, type RepaymentResult, type UpiWebhookPayload, type WebhookResult, type Role,
} from '@billbridge/shared';
import type { UpiTransaction as UpiRow } from '@prisma/client';
import type { AuthUser } from '../auth/hooks.js';
import { HttpError, type AppContext } from '../context.js';
import { callerFor, operatorCaller } from '../ledger/identity.js';
import { activeReservedUnits, createIntent, newUpiRef, recordPayout, sweepExpired, toUpiTransaction } from '../upi/service.js';
import { recordAnomalyFor } from './anomaly.js';
import { UserDirectory, findUserByParticipant } from './users.js';

// ───────────── invest intent ─────────────
export async function createInvestIntent(ctx: AppContext, investor: AuthUser, invoiceId: string, units: number): Promise<PaymentIntentResponse> {
  await sweepExpired(ctx.db);
  const caller = callerFor(investor);
  const inv = await ctx.ledger.getInvoice(caller, invoiceId);
  if (inv.status !== 'LISTED' && inv.status !== 'PARTIALLY_FUNDED') {
    throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; investments are accepted only while LISTED or PARTIALLY_FUNDED`, { invoiceId, from: inv.status });
  }
  const participant = await ctx.ledger.getParticipant(caller, investor.participantId);
  if (participant.frozen) throw new LedgerError('ERR_PARTICIPANT_FROZEN', `participant ${participant.id} is frozen: ${participant.frozenReason ?? ''}`.trim(), { participantId: participant.id });
  if (participant.kycStatus !== 'APPROVED') throw new LedgerError('ERR_KYC_NOT_APPROVED', `participant ${participant.id} KYC status is ${participant.kycStatus}; must be APPROVED`, { participantId: participant.id, kycStatus: participant.kycStatus });
  const reserved = await activeReservedUnits(ctx.db, invoiceId);
  const available = inv.totalUnits - inv.unitsSold - reserved;
  if (units > available) throw new LedgerError('ERR_UNITS_UNAVAILABLE', `requested ${units} units but only ${available} available (${reserved} reserved by pending payments)`, { invoiceId, requested: units, available, reserved });
  const amountPaise = units * inv.pricePerUnitPaise;
  const holdings = await ctx.ledger.getHoldingsByInvoice(caller, invoiceId);
  const existing = holdings.find((h) => h.holderId === investor.participantId)?.costPaise ?? 0;
  if (participant.perInvoiceCapPaise > 0 && existing + amountPaise > participant.perInvoiceCapPaise) {
    throw new LedgerError('ERR_CAP_EXCEEDED', `cumulative investment ${existing + amountPaise} paise would exceed your per-invoice cap of ${participant.perInvoiceCapPaise} paise`, { invoiceId, investorId: investor.participantId, capPaise: participant.perInvoiceCapPaise, existingPaise: existing, requestedPaise: amountPaise });
  }
  const { row, response } = await createIntent(ctx.db, ctx.upi, {
    kind: 'FUNDING', amountPaise, invoiceId, participantId: investor.participantId, payerVpa: investor.vpa, payeeVpa: ctx.config.upi.platformVpa,
    payeeName: ctx.config.upi.platformName, note: `BillBridge ${units}u ${invoiceId.slice(0, 8)}`, units, ttlSeconds: ctx.config.upi.intentTtlSeconds,
  });
  await ctx.db.upiReservation.create({ data: { invoiceId, investorId: investor.participantId, units, upiRef: row.upiRef, expiresAt: row.expiresAt ?? new Date(Date.now() + ctx.config.upi.intentTtlSeconds * 1000) } });
  ctx.log.info({ upiRef: row.upiRef, invoiceId, participantId: investor.participantId, units, amountPaise }, 'funding intent created');
  return response;
}

// ───────────── repayment intent ─────────────
export async function createRepaymentIntent(ctx: AppContext, buyer: AuthUser, invoiceId: string): Promise<PaymentIntentResponse> {
  await sweepExpired(ctx.db);
  const caller = callerFor(buyer);
  const inv = await ctx.ledger.getInvoice(caller, invoiceId);
  if (inv.buyerId !== buyer.participantId) throw new LedgerError('ERR_IDENTITY_MISMATCH', `caller ${buyer.participantId} is not the buyer of this invoice`, { invoiceId, buyerId: inv.buyerId });
  if (inv.status !== 'SUPPLIER_PAID' && inv.status !== 'LATE') throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; repayment requires SUPPLIER_PAID or LATE`, { invoiceId, from: inv.status });
  const { row, response } = await createIntent(ctx.db, ctx.upi, {
    kind: 'BUYER_REPAYMENT', amountPaise: inv.faceValuePaise, invoiceId, participantId: buyer.participantId, payerVpa: buyer.vpa, payeeVpa: ctx.config.upi.platformVpa,
    payeeName: ctx.config.upi.platformName, note: `BillBridge repayment ${invoiceId.slice(0, 8)}`, ttlSeconds: ctx.config.upi.intentTtlSeconds,
  });
  ctx.log.info({ upiRef: row.upiRef, invoiceId, participantId: buyer.participantId, amountPaise: inv.faceValuePaise }, 'repayment intent created');
  return response;
}

// ───────────── webhook ─────────────
function resultOf(row: UpiRow, replayed: boolean, message?: string): WebhookResult {
  return { upiRef: row.upiRef, status: row.status as WebhookResult['status'], replayed, ledgerTxId: row.ledgerTxId, errorCode: row.errorCode, ...(message ? { message } : {}) };
}

export async function handleWebhook(ctx: AppContext, payload: UpiWebhookPayload): Promise<WebhookResult> {
  const row = await ctx.db.upiTransaction.findUnique({ where: { upiRef: payload.upiRef } });
  if (!row) throw new HttpError(404, 'ERR_NOT_FOUND', `unknown upiRef ${payload.upiRef}`, { upiRef: payload.upiRef });
  const log = ctx.log.child({ upiRef: row.upiRef, invoiceId: row.invoiceId ?? undefined, participantId: row.participantId ?? undefined });
  // idempotency: anything past INITIATED has already been processed once
  if (row.status !== 'INITIATED') {
    if (row.webhookResult) { const prev = JSON.parse(row.webhookResult) as WebhookResult; return { ...prev, replayed: true }; }
    return resultOf(row, true, 'already processed');
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    const expired = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'EXPIRED', errorCode: 'EXPIRED' } });
    await ctx.db.upiReservation.updateMany({ where: { upiRef: row.upiRef }, data: { released: true } });
    return finish(ctx, expired, 'payment intent expired before the webhook arrived');
  }
  if (payload.status === 'FAILED') {
    const failed = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'FAILED', errorCode: 'PROVIDER_FAILED', providerTxnId: payload.providerTxnId, payerVpa: payload.payerVpa } });
    await ctx.db.upiReservation.updateMany({ where: { upiRef: row.upiRef }, data: { released: true } });
    log.info('UPI payment failed at provider');
    return finish(ctx, failed, 'provider reported FAILED');
  }
  if (payload.amountPaise !== row.amountPaise) {
    const bad = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'REFUND_REQUIRED', errorCode: 'ERR_AMOUNT_MISMATCH', providerTxnId: payload.providerTxnId, payerVpa: payload.payerVpa } });
    await ctx.db.upiReservation.updateMany({ where: { upiRef: row.upiRef }, data: { released: true } });
    await refund(ctx, bad, payload.amountPaise, 'amount mismatch');
    return finish(ctx, bad, `webhook amount ${payload.amountPaise} != expected ${row.amountPaise}; refund initiated`);
  }
  const processing = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'PROCESSING', providerTxnId: payload.providerTxnId, payerVpa: payload.payerVpa } });
  if (processing.kind === 'FUNDING') return settleFunding(ctx, processing, log);
  if (processing.kind === 'BUYER_REPAYMENT') return settleRepayment(ctx, processing, log);
  const unsupported = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'FAILED', errorCode: 'ERR_UPI_STATE' } });
  return finish(ctx, unsupported, `unsupported inbound kind ${row.kind}`);
}

async function finish(ctx: AppContext, row: UpiRow, message?: string): Promise<WebhookResult> {
  const result = resultOf(row, false, message);
  await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { webhookResult: JSON.stringify(result) } });
  return result;
}

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

async function settleFunding(ctx: AppContext, row: UpiRow, log: Log): Promise<WebhookResult> {
  const investorUser = row.participantId ? await findUserByParticipant(ctx, row.participantId) : null;
  if (!investorUser || !row.invoiceId || !row.units) {
    const failed = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'REFUND_REQUIRED', errorCode: 'ERR_INTERNAL' } });
    await refund(ctx, failed, row.amountPaise, 'orphaned funding intent');
    return finish(ctx, failed, 'funding intent has no investor/invoice; refund initiated');
  }
  const caller = callerFor({ role: investorUser.role as Role, participantId: investorUser.participantId });
  try {
    const r = await ctx.ledger.invest(caller, row.invoiceId, investorUser.participantId, row.units, row.upiRef);
    const ok = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'SUCCESS', ledgerTxId: r.txId, errorCode: null } });
    await ctx.db.upiReservation.updateMany({ where: { upiRef: row.upiRef }, data: { released: true } });
    log.info({ txId: r.txId, units: row.units, amountPaise: row.amountPaise, unitsSold: r.data.invoice.unitsSold, totalUnits: r.data.invoice.totalUnits }, 'investment recorded on-chain');
    const result = await finish(ctx, ok, r.data.replayed ? 'ledger replay (idempotent upiRef)' : undefined);
    if (r.data.invoice.status === 'FULLY_FUNDED' && ctx.config.autoSupplierPayout) {
      try {
        const payout = await supplierPayout(ctx, row.invoiceId);
        log.info({ invoiceId: row.invoiceId, upiRef: payout.upi.upiRef, amountPaise: payout.payment.amountPaise, txId: payout.tx.txId }, 'AUTO supplier payout released (invoice fully funded)');
      } catch (e) {
        log.error({ err: e, invoiceId: row.invoiceId }, 'auto supplier payout failed (operator can retry via /supplier-payout)');
      }
    }
    return result;
  } catch (e) {
    if (!(e instanceof LedgerError)) throw e;
    log.warn({ errorCode: e.code, details: e.details }, 'ledger rejected funding; refund required');
    await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'FAILED_LEDGER_REJECTED', errorCode: e.code } });
    const rr = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'REFUND_REQUIRED' } });
    await ctx.db.upiReservation.updateMany({ where: { upiRef: row.upiRef }, data: { released: true } });
    await refund(ctx, rr, row.amountPaise, e.code);
    await recordAnomalyFor(ctx, e, investorUser.participantId, row.invoiceId);
    return finish(ctx, rr, `ledger rejected: ${e.message}`);
  }
}

async function settleRepayment(ctx: AppContext, row: UpiRow, log: Log): Promise<WebhookResult> {
  if (!row.invoiceId) {
    const failed = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'REFUND_REQUIRED', errorCode: 'ERR_INTERNAL' } });
    await refund(ctx, failed, row.amountPaise, 'orphaned repayment intent');
    return finish(ctx, failed, 'repayment intent has no invoice; refund initiated');
  }
  try {
    const r = await recordRepayment(ctx, row.invoiceId, row.upiRef, row.amountPaise);
    const ok = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'SUCCESS', ledgerTxId: r.tx.txId, errorCode: null } });
    log.info({ txId: r.tx.txId, onTime: r.onTime, distributions: r.distributions.length }, 'repayment recorded on-chain');
    return finish(ctx, ok);
  } catch (e) {
    if (!(e instanceof LedgerError)) throw e;
    log.warn({ errorCode: e.code }, 'ledger rejected repayment; refund required');
    await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'FAILED_LEDGER_REJECTED', errorCode: e.code } });
    const rr = await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { status: 'REFUND_REQUIRED' } });
    await refund(ctx, rr, row.amountPaise, e.code);
    await recordAnomalyFor(ctx, e, row.participantId ?? 'unknown', row.invoiceId);
    return finish(ctx, rr, `ledger rejected: ${e.message}`);
  }
}

async function refund(ctx: AppContext, row: UpiRow, amountPaise: number, reason: string): Promise<void> {
  const payeeVpa = row.payerVpa ?? (row.participantId ? await new UserDirectory(ctx).vpa(row.participantId) : 'unknown@upi');
  const out = await recordPayout(ctx.db, ctx.upi, { upiRef: `${row.upiRef}-X`, amountPaise, payeeVpa, participantId: row.participantId ?? 'unknown', kind: 'REFUND', invoiceId: row.invoiceId, note: reason });
  ctx.log.info({ upiRef: row.upiRef, refundRef: out.upiRef, amountPaise, reason }, 'simulated refund issued');
}

// ───────────── supplier payout ─────────────
export async function supplierPayout(ctx: AppContext, invoiceId: string) {
  const upiRef = newUpiRef('SUPPLIER_PAYOUT');
  const r = await ctx.ledger.releaseToSupplier(operatorCaller(), invoiceId, upiRef);
  const vpa = await new UserDirectory(ctx).vpa(r.data.invoice.supplierId);
  const row = await recordPayout(ctx.db, ctx.upi, { upiRef, amountPaise: r.data.payment.amountPaise, payeeVpa: vpa, participantId: r.data.invoice.supplierId, kind: 'SUPPLIER_PAYOUT', invoiceId, ledgerTxId: r.txId });
  ctx.log.info({ invoiceId, upiRef, amountPaise: r.data.payment.amountPaise, txId: r.txId, supplierId: r.data.invoice.supplierId }, 'supplier payout released');
  return { invoice: r.data.invoice, payment: r.data.payment, upi: toUpiTransaction(row), tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
}

// ───────────── repayment (operator or webhook-driven) ─────────────
export async function recordRepayment(ctx: AppContext, invoiceId: string, upiRef: string, amountPaise: number) {
  const r = await ctx.ledger.recordRepayment(operatorCaller(), invoiceId, upiRef, amountPaise);
  await distributionPayouts(ctx, r.data, r.txId);
  // make sure an inbound row exists for operator-driven repayments (no intent)
  const existing = await ctx.db.upiTransaction.findUnique({ where: { upiRef } });
  if (!existing) {
    await ctx.db.upiTransaction.create({
      data: { upiRef, kind: 'BUYER_REPAYMENT', direction: 'IN', status: 'SUCCESS', amountPaise, invoiceId, participantId: r.data.invoice.buyerId, payerVpa: null, payeeVpa: ctx.config.upi.platformVpa, ledgerTxId: r.txId },
    });
  }
  return { ...r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
}

export async function distributionPayouts(ctx: AppContext, result: RepaymentResult, ledgerTxId: string): Promise<void> {
  const dir = new UserDirectory(ctx);
  for (const d of result.distributions) {
    await recordPayout(ctx.db, ctx.upi, { upiRef: d.upiRef, amountPaise: d.amountPaise, payeeVpa: await dir.vpa(d.toId), participantId: d.toId, kind: 'INVESTOR_DISTRIBUTION', invoiceId: d.invoiceId, ledgerTxId });
  }
  if (result.residual) {
    const res = result.residual;
    await recordPayout(ctx.db, ctx.upi, { upiRef: res.upiRef, amountPaise: res.amountPaise, payeeVpa: await dir.vpa(res.toId), participantId: res.toId, kind: 'SUPPLIER_RESIDUAL', invoiceId: res.invoiceId, ledgerTxId });
  }
}
