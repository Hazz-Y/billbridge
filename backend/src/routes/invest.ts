import { z } from 'zod';
import {
  InvestIntentRequestSchema, PaymentIntentResponseSchema, PortfolioResponseSchema, UpiStatusSchema, UpiTransactionSchema, UpiWebhookPayloadSchema, WebhookResultSchema,
} from '@billbridge/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { currentUser, requireAuth, requireRole } from '../auth/hooks.js';
import { HttpError, type AppContext } from '../context.js';
import { createInvestIntent, handleWebhook } from '../services/payments.js';
import { portfolio } from '../services/platform.js';
import { sweepExpired, toUpiTransaction } from '../upi/service.js';

const InvoiceParams = z.object({ invoiceId: z.string().min(1) });
const RefParams = z.object({ upiRef: z.string().min(1) });
const UpiListQuery = z.object({ invoiceId: z.string().optional(), status: UpiStatusSchema.optional() });

export async function investRoutes(fastify: FastifyInstance, ctx: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/api/invest/:invoiceId/intent', {
    schema: { tags: ['invest'], security: [{ bearerAuth: [] }], params: InvoiceParams, body: InvestIntentRequestSchema, response: { 200: PaymentIntentResponseSchema } },
    preHandler: requireRole(ctx, 'INVESTOR'),
  }, async (req) => createInvestIntent(ctx, currentUser(req), req.params.invoiceId, req.body.units));

  app.post('/api/invest/webhook', {
    schema: {
      tags: ['invest'], summary: 'UPI provider webhook (HMAC-SHA256 of the raw body in x-upi-signature, unix/ISO time in x-upi-timestamp)',
      headers: z.object({ 'x-upi-signature': z.string().optional(), 'x-upi-timestamp': z.string().optional() }),
      body: UpiWebhookPayloadSchema, response: { 200: WebhookResultSchema },
    },
    config: { rawBody: true },
  }, async (req) => {
    const raw = typeof req.rawBody === 'string' ? req.rawBody : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const sig = req.headers['x-upi-signature'];
    const ts = req.headers['x-upi-timestamp'];
    const v = await ctx.upi.processWebhook(raw, { signature: typeof sig === 'string' ? sig : undefined, timestamp: typeof ts === 'string' ? ts : undefined });
    if (!v.ok) {
      req.log.warn({ upiRef: req.body.upiRef, reason: v.message }, 'webhook rejected');
      throw new HttpError(v.code === 'ERR_UPI_SIGNATURE' ? 401 : 400, v.code, v.message);
    }
    const result = await handleWebhook(ctx, v.payload);
    req.log.info({ upiRef: result.upiRef, status: result.status, replayed: result.replayed, ledgerTxId: result.ledgerTxId, errorCode: result.errorCode }, 'webhook processed');
    return result;
  });

  app.get('/api/invest/portfolio', {
    schema: { tags: ['invest'], security: [{ bearerAuth: [] }], response: { 200: PortfolioResponseSchema } },
    preHandler: requireRole(ctx, 'INVESTOR'),
  }, async (req) => portfolio(ctx, currentUser(req)));

  app.get('/api/invest/upi/:upiRef', {
    schema: { tags: ['invest'], security: [{ bearerAuth: [] }], params: RefParams, response: { 200: UpiTransactionSchema } },
    preHandler: requireAuth(ctx),
  }, async (req) => {
    await sweepExpired(ctx.db);
    const user = currentUser(req);
    const row = await ctx.db.upiTransaction.findUnique({ where: { upiRef: req.params.upiRef } });
    if (!row) throw new HttpError(404, 'ERR_NOT_FOUND', `upiRef ${req.params.upiRef} not found`);
    if (user.role !== 'OPERATOR' && user.role !== 'REGULATOR' && row.participantId !== user.participantId) throw new HttpError(403, 'ERR_FORBIDDEN', 'not your UPI transaction');
    return toUpiTransaction(row);
  });

  app.get('/api/invest/upi', {
    schema: { tags: ['invest'], security: [{ bearerAuth: [] }], querystring: UpiListQuery, response: { 200: z.object({ items: z.array(UpiTransactionSchema) }) } },
    preHandler: requireAuth(ctx),
  }, async (req) => {
    await sweepExpired(ctx.db);
    const user = currentUser(req);
    const privileged = user.role === 'OPERATOR' || user.role === 'REGULATOR';
    const rows = await ctx.db.upiTransaction.findMany({
      where: { ...(privileged ? {} : { participantId: user.participantId }), ...(req.query.invoiceId ? { invoiceId: req.query.invoiceId } : {}), ...(req.query.status ? { status: req.query.status } : {}) },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    return { items: rows.map(toUpiTransaction) };
  });
}
