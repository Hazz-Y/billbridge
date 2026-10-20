/** UPI off-chain state machine (SQLite): INITIATED -> PROCESSING -> SUCCESS | FAILED | EXPIRED (+ ledger-rejection states). */
import { randomBytes } from 'node:crypto';
import type { UpiTransaction as UpiRow } from '@prisma/client';
import type { PaymentIntentResponse, UpiStatus, UpiTransaction } from '@billbridge/shared';
import type { Db } from '../db.js';
import type { PayoutInput, UpiProvider } from './provider.js';

export type UpiKind = UpiTransaction['kind'];

export function newUpiRef(kind: UpiKind | 'F' | 'R' | 'P' | 'D' | 'X', now = Date.now()): string {
  const short: Record<string, string> = { FUNDING: 'F', BUYER_REPAYMENT: 'R', SUPPLIER_PAYOUT: 'P', INVESTOR_DISTRIBUTION: 'D', SUPPLIER_RESIDUAL: 'S', REFUND: 'X' };
  const k = short[kind] ?? kind;
  const rand = randomBytes(3).toString('base64url').replace(/[^A-Za-z0-9]/g, 'Z').slice(0, 4).toUpperCase().padEnd(4, 'Q');
  return `BB-${k}-${now.toString(36).toUpperCase()}-${rand}`;
}

export function toUpiTransaction(r: UpiRow): UpiTransaction {
  return {
    upiRef: r.upiRef, kind: r.kind as UpiTransaction['kind'], direction: r.direction as 'IN' | 'OUT', status: r.status as UpiStatus,
    amountPaise: r.amountPaise, invoiceId: r.invoiceId, participantId: r.participantId, payerVpa: r.payerVpa, payeeVpa: r.payeeVpa,
    deeplink: r.deeplink, ledgerTxId: r.ledgerTxId, errorCode: r.errorCode, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  };
}

export interface IntentInput {
  kind: 'FUNDING' | 'BUYER_REPAYMENT';
  amountPaise: number;
  invoiceId: string;
  participantId: string;
  payerVpa: string | null;
  payeeVpa: string;
  payeeName: string;
  note: string;
  units?: number;
  ttlSeconds: number;
}

/** Creates an INITIATED inbound UPI transaction with deeplink + QR. */
export async function createIntent(db: Db, provider: UpiProvider, input: IntentInput): Promise<{ row: UpiRow; response: PaymentIntentResponse }> {
  const upiRef = newUpiRef(input.kind);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  const pr = await provider.generatePaymentRequest({ upiRef, amountPaise: input.amountPaise, payeeVpa: input.payeeVpa, payeeName: input.payeeName, note: input.note, expiresAt });
  const row = await db.upiTransaction.create({
    data: {
      upiRef, kind: input.kind, direction: 'IN', status: 'INITIATED', amountPaise: input.amountPaise, invoiceId: input.invoiceId,
      participantId: input.participantId, payerVpa: input.payerVpa, payeeVpa: input.payeeVpa, deeplink: pr.deeplink, units: input.units ?? null, expiresAt,
    },
  });
  const response: PaymentIntentResponse = {
    upiRef, amountPaise: input.amountPaise, ...(input.units !== undefined ? { units: input.units } : {}), deeplink: pr.deeplink, qrDataUrl: pr.qrDataUrl,
    payeeVpa: input.payeeVpa, payeeName: input.payeeName, expiresAt: expiresAt.toISOString(), status: 'INITIATED',
  };
  return { row, response };
}

/** Expire INITIATED intents past their expiresAt and release their reservations. Returns the number expired. */
export async function sweepExpired(db: Db, now = new Date()): Promise<number> {
  const stale = await db.upiTransaction.findMany({ where: { status: 'INITIATED', expiresAt: { lt: now } } });
  if (stale.length === 0) return 0;
  const refs = stale.map((s) => s.upiRef);
  await db.$transaction([
    db.upiTransaction.updateMany({ where: { upiRef: { in: refs } }, data: { status: 'EXPIRED', errorCode: 'EXPIRED' } }),
    db.upiReservation.updateMany({ where: { upiRef: { in: refs } }, data: { released: true } }),
  ]);
  return stale.length;
}

/** Simulated outbound payout: creates an OUT row (SUCCESS) with the deterministic ref the ledger used. Idempotent on upiRef. */
export async function recordPayout(db: Db, provider: UpiProvider, input: PayoutInput & { ledgerTxId?: string | null }): Promise<UpiRow> {
  const existing = await db.upiTransaction.findUnique({ where: { upiRef: input.upiRef } });
  if (existing) return existing;
  const res = await provider.initiatePayout(input);
  return db.upiTransaction.create({
    data: {
      upiRef: input.upiRef, kind: input.kind, direction: 'OUT', status: res.status, amountPaise: input.amountPaise, invoiceId: input.invoiceId,
      participantId: input.participantId, payerVpa: null, payeeVpa: input.payeeVpa, deeplink: null, ledgerTxId: input.ledgerTxId ?? null,
      providerTxnId: res.providerTxnId, errorCode: null,
    },
  });
}

export async function activeReservedUnits(db: Db, invoiceId: string, now = new Date()): Promise<number> {
  const rows = await db.upiReservation.findMany({ where: { invoiceId, released: false, expiresAt: { gt: now } } });
  return rows.reduce((s, r) => s + r.units, 0);
}
