import { z } from 'zod';
import {
  AnomalyListResponseSchema, AuditEventsQuerySchema, AuditEventsResponseSchema, FreezeRequestSchema, KycRequestSchema, NetworkResponseSchema, PaginationQuerySchema,
  ParticipantListResponseSchema, ParticipantWithUserSchema, ReconciliationResponseSchema, ScoreResponseSchema, StatsResponseSchema, type EnvelopeEvent, type Role, type SseEvent,
} from '@billbridge/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { currentUser, requireAuth, requireRole, type AuthUser } from '../auth/hooks.js';
import type { AppContext } from '../context.js';
import { callerFor, operatorCaller } from '../ledger/identity.js';
import { anomalies, network, participants, reconciliation, scoreFor, stats } from '../services/platform.js';
import { UserDirectory } from '../services/users.js';

const PRIVILEGED: Role[] = ['OPERATOR', 'REGULATOR'];

/** Role-based event visibility for SSE / audit listing. */
export async function eventVisible(ctx: AppContext, user: AuthUser, ev: EnvelopeEvent): Promise<boolean> {
  if (PRIVILEGED.includes(user.role)) return true;
  if (ev.fn === 'RecordAnomaly') return false;
  if (ev.fn === 'AdvanceDemoClock') return true;
  if (ev.actorId === user.participantId) return true;
  if (!ev.invoiceId) return false;
  try {
    const inv = await ctx.ledger.getInvoice(operatorCaller(), ev.invoiceId);
    if (inv.supplierId === user.participantId || inv.buyerId === user.participantId) return true;
    if (user.role === 'INVESTOR') {
      const holdings = await ctx.ledger.getHoldingsByInvoice(operatorCaller(), ev.invoiceId);
      return holdings.some((h) => h.holderId === user.participantId);
    }
  } catch { /* unknown invoice */ }
  return false;
}

function csvEscape(v: unknown): string { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export async function platformRoutes(fastify: FastifyInstance, ctx: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/platform/stats', { schema: { tags: ['platform'], response: { 200: StatsResponseSchema } } }, async () => stats(ctx));

  app.get('/api/platform/scores/:buyerId', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], params: z.object({ buyerId: z.string().min(1) }), response: { 200: ScoreResponseSchema } },
    preHandler: requireAuth(ctx),
  }, async (req) => scoreFor(ctx, currentUser(req), req.params.buyerId));

  app.get('/api/platform/reconciliation', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], response: { 200: ReconciliationResponseSchema } },
    preHandler: requireRole(ctx, 'OPERATOR', 'REGULATOR'),
  }, async () => reconciliation(ctx));

  // ── SSE ──
  app.get('/api/platform/audit/stream', {
    schema: { tags: ['platform'], summary: 'Server-sent events: `event: ledger`, `id: <seq>`, `data: SseEvent`; heartbeat comment every 15 s', querystring: z.object({ token: z.string().optional(), lastEventId: z.coerce.number().int().optional() }) },
    preHandler: requireAuth(ctx),
  }, async (req, reply) => {
    const user = currentUser(req);
    const headerId = req.headers['last-event-id'];
    const lastId = req.query.lastEventId ?? (typeof headerId === 'string' && /^\d+$/.test(headerId) ? Number(headerId) : null);
    reply.hijack();
    const res = reply.raw;
    const headers: Record<string, string> = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' };
    for (const [k, v] of Object.entries(reply.getHeaders())) if (typeof v === 'string') headers[k] = v;
    res.writeHead(200, headers);
    res.write(': connected\n\n');
    let closed = false;
    const send = (ev: SseEvent) => { if (!closed) res.write(`event: ledger\nid: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`); };
    // serialise filter checks so order is preserved
    let chain: Promise<void> = Promise.resolve();
    const push = (ev: SseEvent) => { chain = chain.then(async () => { if (await eventVisible(ctx, user, ev)) send(ev); }).catch(() => undefined); };
    if (lastId !== null) for (const ev of await ctx.events.replay(lastId)) push(ev);
    const unsubscribe = ctx.events.subscribe(push);
    const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
    const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); try { res.end(); } catch { /* ignore */ } };
    req.raw.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    req.log.info({ lastEventId: lastId, role: user.role }, 'sse client connected');
  });

  app.get('/api/platform/audit/events', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], querystring: AuditEventsQuerySchema, response: { 200: z.union([AuditEventsResponseSchema, z.string()]) } },
    preHandler: requireAuth(ctx),
  }, async (req, reply) => {
    const user = currentUser(req);
    const q = req.query;
    const afterSeq = q.bookmark && /^\d+$/.test(q.bookmark) ? Number(q.bookmark) : 0;
    const rows = await ctx.db.ledgerEvent.findMany({
      where: {
        seq: { gt: afterSeq }, ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}), ...(q.participantId ? { actorId: q.participantId } : {}),
        ...(q.type ? { fn: q.type } : {}), ...(q.from || q.to ? { timestamp: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      },
      orderBy: { seq: 'asc' }, take: q.format === 'csv' ? 5000 : q.pageSize + 1,
    });
    const items: SseEvent[] = [];
    for (const r of rows) {
      const ev = { ...(JSON.parse(r.envelope) as EnvelopeEvent), seq: r.seq };
      if (!q.type || ev.fn === q.type || ev.events.some((s) => s.type === q.type)) if (await eventVisible(ctx, user, ev)) items.push(ev);
    }
    if (q.format === 'csv') {
      const head = 'seq,txId,blockNumber,timestamp,fn,actorId,actorRole,invoiceId,subEvents';
      const lines = items.map((e) => [e.seq, e.txId, e.blockNumber, e.timestamp, e.fn, e.actorId, e.actorRole, e.invoiceId ?? '', e.events.map((s) => s.type).join('|')].map(csvEscape).join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="billbridge-audit.csv"');
      return reply.send([head, ...lines].join('\n'));
    }
    const page = items.slice(0, q.pageSize);
    const last = page[page.length - 1];
    return { items: page, nextBookmark: rows.length > q.pageSize && last ? String(last.seq) : null };
  });

  app.get('/api/platform/anomalies', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], querystring: PaginationQuerySchema, response: { 200: AnomalyListResponseSchema } },
    preHandler: requireRole(ctx, 'OPERATOR', 'REGULATOR'),
  }, async (req) => anomalies(ctx, currentUser(req), req.query.pageSize, req.query.bookmark));

  app.get('/api/platform/participants', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], response: { 200: ParticipantListResponseSchema } },
    preHandler: requireRole(ctx, 'OPERATOR', 'REGULATOR'),
  }, async (req) => participants(ctx, currentUser(req)));

  const PidParams = z.object({ participantId: z.string().min(1) });
  app.post('/api/platform/kyc/:participantId', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], params: PidParams, body: KycRequestSchema, response: { 200: ParticipantWithUserSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const r = await ctx.ledger.setKycStatus(callerFor(currentUser(req)), req.params.participantId, req.body.status, req.body.kycDocHash ?? '');
    req.log.info({ participantId: req.params.participantId, status: req.body.status, txId: r.txId }, 'KYC status updated');
    const u = await new UserDirectory(ctx).byParticipant(r.data.id);
    return { ...r.data, name: u?.name ?? r.data.id, email: u?.email ?? '', orgName: u?.orgName ?? '' };
  });

  app.post('/api/platform/freeze/:participantId', {
    schema: { tags: ['platform'], security: [{ bearerAuth: [] }], params: PidParams, body: FreezeRequestSchema, response: { 200: ParticipantWithUserSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const caller = callerFor(currentUser(req));
    const r = req.body.frozen ? await ctx.ledger.freezeParticipant(caller, req.params.participantId, req.body.reason ?? 'frozen by operator') : await ctx.ledger.unfreezeParticipant(caller, req.params.participantId);
    req.log.warn({ participantId: req.params.participantId, frozen: req.body.frozen, txId: r.txId }, 'participant freeze state changed');
    const u = await new UserDirectory(ctx).byParticipant(r.data.id);
    return { ...r.data, name: u?.name ?? r.data.id, email: u?.email ?? '', orgName: u?.orgName ?? '' };
  });

  app.get('/api/platform/network', { schema: { tags: ['platform'], response: { 200: NetworkResponseSchema } } }, async () => network(ctx));
}
