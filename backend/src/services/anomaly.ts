/** Anomaly recording: SQLite mirror row + on-chain RecordAnomaly (operator). Never throws (the original error is what the client sees). */
import { ANOMALY_KIND_FOR_CODE, GUARD_LABEL, LedgerError, type AnomalyRecord } from '@billbridge/shared';
import type { AppContext } from '../context.js';
import { operatorCaller } from '../ledger/identity.js';

export interface RecordedAnomaly { kind: string; anomalyId: string | null; txId: string | null; guard: string }

export function anomalyKindFor(err: unknown): string | null {
  if (!(err instanceof LedgerError)) return null;
  return ANOMALY_KIND_FOR_CODE[err.code] ?? null;
}

export async function recordAnomalyFor(ctx: AppContext, err: LedgerError, actorId: string, invoiceRef: string): Promise<RecordedAnomaly | null> {
  const kind = anomalyKindFor(err);
  if (!kind) return null;
  const guard = GUARD_LABEL[kind] ?? kind;
  const ref = invoiceRef || (typeof err.details['existingInvoiceId'] === 'string' ? (err.details['existingInvoiceId'] as string) : '') || (typeof err.details['invoiceId'] === 'string' ? (err.details['invoiceId'] as string) : '');
  const row = await ctx.db.anomaly.create({ data: { kind, actorId, invoiceRef: ref || null, errorCode: err.code, detail: err.message } });
  let txId: string | null = null;
  let anomalyId: string | null = null;
  try {
    const r = await ctx.ledger.recordAnomaly(operatorCaller(), kind, actorId, ref, err.code, err.message);
    txId = r.txId; anomalyId = r.data.anomalyId;
    await ctx.db.anomaly.update({ where: { id: row.id }, data: { ledgerTxId: txId, anomalyId } });
    ctx.log.warn({ kind, actorId, invoiceRef: ref, errorCode: err.code, txId, guard }, 'anomaly recorded on-chain');
  } catch (e) {
    ctx.log.error({ err: e, kind, actorId }, 'failed to record anomaly on-chain (mirror row kept)');
  }
  return { kind, anomalyId, txId, guard };
}

export function withGuard(a: AnomalyRecord): AnomalyRecord & { guard: string } {
  return { ...a, guard: GUARD_LABEL[a.kind] ?? a.kind };
}
