import { z } from 'zod';
import {
  BuyerScoreSchema, HoldingSchema, InvoiceSchema, InvoiceWithMetaSchema, PaymentIntentResponseSchema, RepaymentRecordRequestSchema, RepaymentResponseSchema,
  SupplierPayoutResponseSchema, TxMetaSchema,
} from '@billbridge/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { currentUser, requireRole } from '../auth/hooks.js';
import type { AppContext } from '../context.js';
import { callerFor } from '../ledger/identity.js';
import { createRepaymentIntent, recordRepayment, supplierPayout } from '../services/payments.js';

const InvoiceParams = z.object({ invoiceId: z.string().min(1) });
const MarkDefaultResponse = z.object({ invoice: InvoiceSchema, buyerScore: BuyerScoreSchema, holdings: z.array(HoldingSchema), tx: TxMetaSchema });

export async function settlementRoutes(fastify: FastifyInstance, ctx: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/api/settlement/:invoiceId/supplier-payout', {
    schema: { tags: ['settlement'], security: [{ bearerAuth: [] }], params: InvoiceParams, response: { 200: SupplierPayoutResponseSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => supplierPayout(ctx, req.params.invoiceId));

  app.post('/api/settlement/:invoiceId/repayment-intent', {
    schema: { tags: ['settlement'], security: [{ bearerAuth: [] }], params: InvoiceParams, response: { 200: PaymentIntentResponseSchema } },
    preHandler: requireRole(ctx, 'BUYER'),
  }, async (req) => createRepaymentIntent(ctx, currentUser(req), req.params.invoiceId));

  app.post('/api/settlement/:invoiceId/repayment', {
    schema: { tags: ['settlement'], security: [{ bearerAuth: [] }], params: InvoiceParams, body: RepaymentRecordRequestSchema, response: { 200: RepaymentResponseSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const r = await recordRepayment(ctx, req.params.invoiceId, req.body.upiRef, req.body.amountPaise);
    req.log.info({ invoiceId: req.params.invoiceId, upiRef: req.body.upiRef, txId: r.tx.txId, onTime: r.onTime }, 'repayment recorded by operator');
    return r;
  });

  app.post('/api/settlement/:invoiceId/mark-late', {
    schema: { tags: ['settlement'], security: [{ bearerAuth: [] }], params: InvoiceParams, response: { 200: InvoiceWithMetaSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const r = await ctx.ledger.markLate(callerFor(currentUser(req)), req.params.invoiceId);
    req.log.info({ invoiceId: req.params.invoiceId, txId: r.txId }, 'invoice marked LATE');
    return { invoice: r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  });

  app.post('/api/settlement/:invoiceId/mark-default', {
    schema: { tags: ['settlement'], security: [{ bearerAuth: [] }], params: InvoiceParams, response: { 200: MarkDefaultResponse } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const r = await ctx.ledger.markDefault(callerFor(currentUser(req)), req.params.invoiceId);
    req.log.warn({ invoiceId: req.params.invoiceId, txId: r.txId, score: r.data.buyerScore.score }, 'invoice marked DEFAULTED');
    return { ...r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  });
}
