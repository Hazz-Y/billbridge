/**
 * Event pipeline: ledger envelope events -> SQLite mirror (events, score_history, anomalies) -> SSE subscribers.
 * Idempotent on txId so a restart + backfill (recentEvents) never duplicates rows.
 */
import type { EnvelopeEvent, LedgerClient, SseEvent } from '@billbridge/shared';
import type { Db } from '../db.js';

type Logger = { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void; debug: (o: unknown, msg?: string) => void };

export type SseSubscriber = (event: SseEvent) => void;

export class EventPipeline {
  private subscribers = new Set<SseSubscriber>();
  private unsubscribe: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  /** Bumped on every processed event; stats cache keys on it. */
  version = 0;
  onInvalidate: (() => void) | null = null;

  constructor(private readonly db: Db, private readonly ledgerClient: LedgerClient, private readonly log: Logger) {}

  async start(): Promise<void> {
    await this.backfill();
    this.unsubscribe = this.ledgerClient.onEvent((ev) => { this.enqueue(ev); });
  }

  stop(): void { this.unsubscribe?.(); this.unsubscribe = null; this.subscribers.clear(); }

  /** Serialises processing so seq order == ledger order. */
  enqueue(ev: EnvelopeEvent): Promise<void> {
    const next = this.chain.then(async () => { await this.process(ev); }).catch((e) => { this.log.error({ err: e, txId: ev.txId }, 'event pipeline failed'); });
    this.chain = next;
    return next;
  }

  /** Wait for everything queued so far to be mirrored (tests, seed). */
  async flush(): Promise<void> { await this.chain; }

  async backfill(): Promise<number> {
    const events = await this.ledgerClient.recentEvents(2000);
    let added = 0;
    for (const ev of events) {
      const r = await this.process(ev, { broadcast: false });
      if (r) added++;
    }
    if (added) this.log.info({ added, total: events.length }, 'event mirror backfilled');
    return added;
  }

  private async process(ev: EnvelopeEvent, opts: { broadcast?: boolean } = {}): Promise<SseEvent | null> {
    const existing = await this.db.ledgerEvent.findUnique({ where: { txId: ev.txId } });
    let seq: number;
    if (existing) {
      seq = existing.seq;
    } else {
      const row = await this.db.ledgerEvent.create({
        data: { txId: ev.txId, blockNumber: ev.blockNumber, fn: ev.fn, actorId: ev.actorId, actorRole: ev.actorRole, invoiceId: ev.invoiceId ?? null, timestamp: ev.timestamp, envelope: JSON.stringify(ev) },
      });
      seq = row.seq;
      await this.derive(ev);
    }
    this.version++;
    this.onInvalidate?.();
    const sse: SseEvent = { ...ev, seq };
    if (opts.broadcast !== false && !existing) {
      for (const s of this.subscribers) { try { s(sse); } catch (e) { this.log.warn({ err: e }, 'sse subscriber threw'); } }
    }
    return existing ? null : sse;
  }

  private async derive(ev: EnvelopeEvent): Promise<void> {
    for (const sub of ev.events) {
      if (sub.type === 'SCORE_UPDATED') {
        const p = sub.payload as { buyerId?: string; score?: number; settledOnTime?: number; settledLate?: number; defaulted?: number; reason?: string };
        if (typeof p.buyerId !== 'string' || typeof p.score !== 'number') continue;
        await this.db.scoreHistory.upsert({
          where: { txId_buyerId: { txId: ev.txId, buyerId: p.buyerId } },
          create: { buyerId: p.buyerId, score: p.score, onTime: p.settledOnTime ?? 0, late: p.settledLate ?? 0, defaulted: p.defaulted ?? 0, reason: p.reason ?? '', txId: ev.txId, timestamp: ev.timestamp },
          update: {},
        });
      } else if (sub.type === 'ANOMALY_RECORDED') {
        const p = sub.payload as { anomalyId?: string; kind?: string; actorId?: string; invoiceRef?: string; errorCode?: string; detail?: string };
        if (typeof p.anomalyId !== 'string') continue;
        const found = await this.db.anomaly.findFirst({ where: { anomalyId: p.anomalyId } });
        if (!found) {
          await this.db.anomaly.create({
            data: { kind: p.kind ?? 'OTHER', actorId: p.actorId ?? ev.actorId, invoiceRef: p.invoiceRef ?? null, errorCode: p.errorCode ?? '', detail: p.detail ?? '', ledgerTxId: ev.txId, anomalyId: p.anomalyId },
          });
        }
      }
    }
  }

  subscribe(fn: SseSubscriber): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  get subscriberCount(): number { return this.subscribers.size; }

  /** Replay mirrored events with seq > afterSeq (ascending). */
  async replay(afterSeq: number, limit = 2000): Promise<SseEvent[]> {
    const rows = await this.db.ledgerEvent.findMany({ where: { seq: { gt: afterSeq } }, orderBy: { seq: 'asc' }, take: limit });
    return rows.map((r) => ({ ...(JSON.parse(r.envelope) as EnvelopeEvent), seq: r.seq }));
  }
}
