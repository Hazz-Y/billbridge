/** Demo-only routes (NODE_ENV !== 'production' && DEMO_MODE=true). */
import { z } from 'zod';
import {
  AttackRequestSchema, AttackResponseSchema, DEMO_USERS, DEMO_USER_BY_ROLE, DemoStateResponseSchema, GUARD_LABEL, LedgerError, SeedResponseSchema, SimulatePaymentRequestSchema,
  SwitchRoleRequestSchema, TimeTravelRequestSchema, TimeTravelResponseSchema, TokenResponseSchema, WebhookResultSchema, toEpochSeconds, type AttackResponse, type CreateInvoiceRequest,
  type UpiWebhookPayload, type WebhookResult, CreateInvoiceRequestSchema,
} from '@billbridge/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AuthUser } from '../auth/hooks.js';
import { issueTokens } from '../auth/service.js';
import { HttpError, type AppContext } from '../context.js';
import { getState, setState } from '../db.js';
import { operatorCaller } from '../ledger/identity.js';
import { resetAndSeed, seed, STATE_SEEDED_AT } from '../demo/seed.js';
import { STATE_LAST_CREATED, STATE_LAST_CREATE_REQUEST, createInvoice, fileBytes, loadOwnedFile, saltedHash } from '../services/invoices.js';
import { invalidateStats } from '../services/platform.js';
import { signWebhook } from '../upi/provider.js';

const STATE_CLOCK_OFFSET = 'clockOffsetSeconds';

export async function demoRoutes(fastify: FastifyInstance, ctx: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/demo/state', { schema: { tags: ['demo'], response: { 200: DemoStateResponseSchema } } }, async () => {
    const clock = await ctx.ledger.getClock(operatorCaller()).catch(() => ({ now: new Date().toISOString(), offsetSeconds: 0, demoMode: ctx.config.demoMode }));
    const pending = await ctx.db.upiTransaction.findMany({ where: { status: { in: ['INITIATED', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      demoMode: ctx.config.demoMode, ledgerMode: ctx.ledgerMode, simulatedNow: clock.now, offsetSeconds: clock.offsetSeconds,
      seeded: (await getState(ctx.db, STATE_SEEDED_AT)) !== null, lastCreatedInvoiceId: await getState(ctx.db, STATE_LAST_CREATED),
      pendingUpiRefs: pending.map((p) => p.upiRef), users: DEMO_USERS.map((u) => ({ email: u.email, name: u.name, role: u.role, participantId: u.participantId })),
    };
  });

  app.post('/api/demo/seed', { schema: { tags: ['demo'], response: { 200: SeedResponseSchema } } }, async () => seed(ctx));
  app.post('/api/demo/reset', { schema: { tags: ['demo'], response: { 200: SeedResponseSchema } } }, async (req) => {
    const r = await resetAndSeed(ctx);
    req.log.warn({ durationMs: r.durationMs }, 'demo reset + reseed complete');
    return r;
  });

  app.post('/api/demo/time-travel', { schema: { tags: ['demo'], body: TimeTravelRequestSchema, response: { 200: TimeTravelResponseSchema } } }, async (req) => {
    const op = operatorCaller();
    let seconds: number;
    if (req.body.toInvoiceId) {
      const inv = await ctx.ledger.getInvoice(op, req.body.toInvoiceId);
      const clock = await ctx.ledger.getClock(op);
      const target = toEpochSeconds(inv.dueDate) + (req.body.plusDays ?? 0) * 86400 + 10 * 3600;
      seconds = target - toEpochSeconds(clock.now);
    } else if (req.body.days !== undefined) seconds = req.body.days * 86400;
    else throw new HttpError(400, 'ERR_VALIDATION', 'provide `days` or `toInvoiceId` (+ `plusDays`)');
    const r = await ctx.ledger.advanceDemoClock(op, seconds);
    await setState(ctx.db, STATE_CLOCK_OFFSET, String(r.data.offsetSeconds));
    invalidateStats();
    req.log.warn({ seconds, simulatedNow: r.data.now, offsetSeconds: r.data.offsetSeconds, txId: r.txId }, 'demo clock advanced');
    return { simulatedNow: r.data.now, offsetSeconds: r.data.offsetSeconds, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  });

  app.post('/api/demo/simulate-payment', { schema: { tags: ['demo'], body: SimulatePaymentRequestSchema, response: { 200: WebhookResultSchema } } }, async (req) => {
    const row = await ctx.db.upiTransaction.findUnique({ where: { upiRef: req.body.upiRef } });
    if (!row) throw new HttpError(404, 'ERR_NOT_FOUND', `upiRef ${req.body.upiRef} not found`);
    await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)));
    const payload: UpiWebhookPayload = {
      upiRef: row.upiRef, status: req.body.fail ? 'FAILED' : 'SUCCESS', amountPaise: row.amountPaise, payerVpa: row.payerVpa ?? 'simulated.payer@upi',
      timestamp: new Date().toISOString(), providerTxnId: `SIM${Date.now().toString(36).toUpperCase()}`,
    };
    const rawBody = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json', 'x-upi-signature': signWebhook(rawBody, ctx.config.upi.webhookSecret), 'x-upi-timestamp': String(Math.floor(Date.now() / 1000)) };
    const url = `${ctx.config.backendUrl}/api/invest/webhook`;
    try {
      const res = await fetch(url, { method: 'POST', headers, body: rawBody, signal: AbortSignal.timeout(20000) });
      const json = (await res.json()) as WebhookResult | { error: { code: string; message: string } };
      if (!res.ok) { const err = json as { error: { code: string; message: string } }; throw new HttpError(res.status, err.error.code, err.error.message); }
      req.log.info({ upiRef: row.upiRef, via: url, status: (json as WebhookResult).status }, 'simulated UPI webhook delivered');
      return json as WebhookResult;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      req.log.warn({ err: e instanceof Error ? e.message : String(e), url }, 'webhook POST via BACKEND_URL failed; delivering in-process');
      const r = await fastify.inject({ method: 'POST', url: '/api/invest/webhook', headers, payload: rawBody });
      if (r.statusCode !== 200) { const err = r.json() as { error: { code: string; message: string } }; throw new HttpError(r.statusCode, err.error.code, err.error.message); }
      return r.json() as WebhookResult;
    }
  });

  app.post('/api/demo/attack/duplicate', { schema: { tags: ['demo'], body: AttackRequestSchema, response: { 200: AttackResponseSchema } } }, async (req) => {
    const stored = await getState(ctx.db, STATE_LAST_CREATE_REQUEST);
    const targetInvoiceId = await getState(ctx.db, STATE_LAST_CREATED);
    if (!stored || !targetInvoiceId) throw new HttpError(409, 'ERR_UPI_STATE', 'no invoice has been created through POST /api/invoices yet; tokenize one first');
    const { userId, body } = JSON.parse(stored) as { userId: string; body: CreateInvoiceRequest };
    const user = (await ctx.db.user.findUnique({ where: { id: userId } })) as AuthUser | null;
    if (!user) throw new HttpError(404, 'ERR_NOT_FOUND', 'creator of the last invoice no longer exists');
    const file = await loadOwnedFile(ctx, user, body.fileId);
    const variant = req.body.variant;
    let request: CreateInvoiceRequest = CreateInvoiceRequestSchema.parse(body);
    let fileOverride: { hash: string } | undefined;
    if (variant === 'SAME_FILE') {
      // attacker re-uploads the SAME PDF bytes but edits the form to dodge guards #1 and #2 -> only the file hash catches it
      const items = request.lineItems.map((li, i) => (i === 0 ? { ...li, description: `${li.description} (revised)`, totalPaise: li.totalPaise + 100000, unitPricePaise: li.quantity > 0 ? li.unitPricePaise : li.unitPricePaise + 100000 } : li));
      request = { ...request, invoiceNumber: `${request.invoiceNumber}-DUP`, faceValuePaise: request.faceValuePaise + 100000, lineItems: items };
    } else if (variant === 'NEW_NUMBER') {
      request = { ...request, invoiceNumber: `${request.invoiceNumber}-R` };
      fileOverride = { hash: saltedHash(fileBytes(file), 1) };
    } else if (variant === 'CHANGED_AMOUNT') {
      const items = request.lineItems.map((li, i) => (i === 0 ? { ...li, totalPaise: li.totalPaise + 100000, unitPricePaise: li.quantity > 0 ? li.unitPricePaise : li.unitPricePaise + 100000 } : li));
      request = { ...request, faceValuePaise: request.faceValuePaise + 100000, lineItems: items };
      fileOverride = { hash: saltedHash(fileBytes(file), 2) };
    }
    req.log.warn({ variant, targetInvoiceId, participantId: user.participantId, invoiceNumber: request.invoiceNumber }, 'ATTACK SIMULATION: duplicate financing attempt');
    try {
      const r = await createInvoice(ctx, user, request, { fileOverride, remember: false });
      const out: AttackResponse = { variant, rejected: false, errorCode: null, message: `NOT REJECTED - invoice ${r.invoice.invoiceId} was created (guards failed!)`, guard: null, anomalyTxId: null, targetInvoiceId: r.invoice.invoiceId };
      return out;
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
      const kind = typeof e.details['anomalyKind'] === 'string' ? (e.details['anomalyKind'] as string) : null;
      const out: AttackResponse = {
        variant, rejected: true, errorCode: e.code, message: e.message, guard: kind ? GUARD_LABEL[kind] ?? kind : null,
        anomalyTxId: typeof e.details['anomalyTxId'] === 'string' ? (e.details['anomalyTxId'] as string) : null,
        targetInvoiceId: typeof e.details['existingInvoiceId'] === 'string' && e.details['existingInvoiceId'] ? (e.details['existingInvoiceId'] as string) : typeof e.details['invoiceId'] === 'string' ? (e.details['invoiceId'] as string) : targetInvoiceId,
      };
      return out;
    }
  });

  app.post('/api/demo/inject-mismatch', { schema: { tags: ['demo'], response: { 200: z.object({ upiRef: z.string(), reason: z.string() }) } } }, async (req) => {
    const row = await ctx.db.upiTransaction.findFirst({ where: { kind: 'FUNDING', status: 'SUCCESS', errorCode: null }, orderBy: { createdAt: 'desc' } });
    if (!row) throw new HttpError(404, 'ERR_NOT_FOUND', 'no SUCCESS funding transaction to tamper with');
    await ctx.db.upiTransaction.update({ where: { upiRef: row.upiRef }, data: { amountPaise: row.amountPaise + 100, errorCode: 'INJECTED' } });
    req.log.warn({ upiRef: row.upiRef }, 'DEMO: injected +100 paise mismatch into the UPI mirror (ledger untouched)');
    return { upiRef: row.upiRef, reason: `UPI mirror amount bumped by 100 paise (now ${row.amountPaise + 100}); the ledger still says ${row.amountPaise}` };
  });

  app.post('/api/demo/switch-role', { schema: { tags: ['demo'], body: SwitchRoleRequestSchema, response: { 200: TokenResponseSchema } } }, async (req) => {
    const email = req.body.email ?? (req.body.role ? DEMO_USER_BY_ROLE[req.body.role] : undefined);
    if (!email) throw new HttpError(400, 'ERR_VALIDATION', 'provide `email` or `role`');
    const user = await ctx.db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new HttpError(404, 'ERR_NOT_FOUND', `no user ${email}; run POST /api/demo/seed first`);
    return issueTokens(ctx, user);
  });
}
