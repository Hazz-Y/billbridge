import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CancelInvoiceRequestSchema, CreateInvoiceRequestSchema, InvoiceDetailSchema, InvoiceHistoryResponseSchema, InvoiceListResponseSchema, InvoiceWithMetaSchema,
  ListInvoiceRequestSchema, ListInvoicesQuerySchema, PricingPreviewSchema, UploadResponseSchema, computePricing, type UploadResponse,
} from '@billbridge/shared';
import { sha256Hex } from '@billbridge/shared/hashing';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { extractInvoice } from '../ai/extract.js';
import { currentUser, requireAuth, requireRole } from '../auth/hooks.js';
import { HttpError, type AppContext } from '../context.js';
import { ensureDir } from '../config.js';
import { setState } from '../db.js';
import { callerFor } from '../ledger/identity.js';
import { STATE_LAST_UPLOAD_PREFIX, createInvoice, getInvoiceDetail, listInvoices, tenorFrom } from '../services/invoices.js';

const ALLOWED_MIME: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
const IdParams = z.object({ id: z.string().min(1) });
const PricingQuery = z.object({ discountBps: z.coerce.number().int().min(1).max(10000), minFundingUnits: z.coerce.number().int().min(1).optional() });

export async function invoiceRoutes(fastify: FastifyInstance, ctx: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/api/invoices/upload', {
    schema: { tags: ['invoices'], summary: 'Upload an invoice file (multipart field `file`: pdf/png/jpg ≤ 10 MB) and run AI extraction', consumes: ['multipart/form-data'], security: [{ bearerAuth: [] }], response: { 200: UploadResponseSchema } },
    preHandler: requireRole(ctx, 'MSME'),
  }, async (req) => {
    const user = currentUser(req);
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) throw new HttpError(400, 'ERR_VALIDATION', 'multipart field `file` is required');
    const mime = part.mimetype.toLowerCase();
    const ext = ALLOWED_MIME[mime];
    if (!ext) throw new HttpError(400, 'ERR_VALIDATION', `unsupported file type ${part.mimetype}; use pdf, png or jpg`);
    const buffer = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(400, 'ERR_VALIDATION', 'file exceeds the 10 MB limit');
    const fileHash = sha256Hex(buffer);
    const extraction = await extractInvoice(buffer, mime === 'image/jpg' ? 'image/jpeg' : mime, req.log);
    const dir = ensureDir(ctx.config.uploadDir);
    const row = await ctx.db.uploadedFile.create({ data: { fileHash, fileName: part.filename, mime, sizeBytes: buffer.length, path: '', ownerId: user.id, extractionJson: JSON.stringify(extraction) } });
    const path = join(dir, `${row.id}.${ext}`);
    writeFileSync(path, buffer);
    await ctx.db.uploadedFile.update({ where: { id: row.id }, data: { path } });
    await setState(ctx.db, `${STATE_LAST_UPLOAD_PREFIX}${user.id}`, row.id);
    const buyer = extraction.buyerGstin ? await ctx.db.user.findFirst({ where: { gstin: extraction.buyerGstin, role: 'BUYER' } }) : null;
    req.log.info({ fileId: row.id, fileHash, sizeBytes: buffer.length, confidence: extraction.confidence, source: extraction.source, buyerId: buyer?.participantId ?? null }, 'invoice uploaded');
    const res: UploadResponse = { fileId: row.id, fileHash, fileName: part.filename, sizeBytes: buffer.length, extraction, buyerId: buyer?.participantId ?? null, buyerName: buyer?.name ?? null };
    return res;
  });

  app.post('/api/invoices', {
    schema: { tags: ['invoices'], summary: 'Tokenize an uploaded invoice (409 + ledger code on any double-financing guard; anomaly recorded on-chain)', security: [{ bearerAuth: [] }], body: CreateInvoiceRequestSchema, response: { 200: InvoiceWithMetaSchema } },
    preHandler: requireRole(ctx, 'MSME'),
  }, async (req) => createInvoice(ctx, currentUser(req), req.body));

  app.get('/api/invoices', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], querystring: ListInvoicesQuerySchema, response: { 200: InvoiceListResponseSchema } },
    preHandler: requireAuth(ctx),
  }, async (req) => {
    // z.coerce.boolean() turns "false" into true; read the raw query string for the flag.
    const raw = new URL(req.url, 'http://x').searchParams.get('marketplace');
    const marketplace = raw === null ? false : !['false', '0', ''].includes(raw.toLowerCase());
    return listInvoices(ctx, currentUser(req), { ...req.query, marketplace });
  });

  app.get('/api/invoices/:id', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], params: IdParams, response: { 200: InvoiceDetailSchema } },
    preHandler: requireAuth(ctx),
  }, async (req) => getInvoiceDetail(ctx, currentUser(req), req.params.id));

  app.get('/api/invoices/:id/history', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], params: IdParams, response: { 200: InvoiceHistoryResponseSchema } },
    preHandler: requireAuth(ctx),
  }, async (req) => ({ items: await ctx.ledger.getInvoiceHistory(callerFor(currentUser(req)), req.params.id) }));

  app.post('/api/invoices/:id/accept', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], params: IdParams, response: { 200: InvoiceWithMetaSchema } },
    preHandler: requireRole(ctx, 'BUYER'),
  }, async (req) => {
    const r = await ctx.ledger.buyerAcceptInvoice(callerFor(currentUser(req)), req.params.id);
    req.log.info({ invoiceId: req.params.id, txId: r.txId }, 'invoice accepted by buyer');
    return { invoice: r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  });

  app.post('/api/invoices/:id/list', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], params: IdParams, body: ListInvoiceRequestSchema, response: { 200: InvoiceWithMetaSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const r = await ctx.ledger.listInvoice(callerFor(currentUser(req)), req.params.id, req.body.discountBps, req.body.minFundingUnits);
    req.log.info({ invoiceId: req.params.id, txId: r.txId, discountBps: req.body.discountBps, pricePerUnitPaise: r.data.pricePerUnitPaise }, 'invoice listed');
    return { invoice: r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  });

  app.post('/api/invoices/:id/cancel', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], params: IdParams, body: CancelInvoiceRequestSchema, response: { 200: InvoiceWithMetaSchema } },
    preHandler: requireRole(ctx, 'MSME', 'OPERATOR'),
  }, async (req) => {
    const r = await ctx.ledger.cancelInvoice(callerFor(currentUser(req)), req.params.id, req.body.reason);
    req.log.info({ invoiceId: req.params.id, txId: r.txId }, 'invoice cancelled');
    return { invoice: r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  });

  app.get('/api/invoices/:id/pricing-preview', {
    schema: { tags: ['invoices'], security: [{ bearerAuth: [] }], params: IdParams, querystring: PricingQuery, response: { 200: PricingPreviewSchema } },
    preHandler: requireRole(ctx, 'OPERATOR'),
  }, async (req) => {
    const caller = callerFor(currentUser(req));
    const inv = await ctx.ledger.getInvoice(caller, req.params.id);
    const clock = await ctx.ledger.getClock(caller);
    // Before listing the tenor is counted from the simulated now; once listed it is frozen on the invoice.
    const tenor = inv.listedAt && inv.tenorDays > 0 ? inv.tenorDays : tenorFrom(inv, clock.now);
    return computePricing(inv.unitFaceValuePaise, req.query.discountBps, tenor);
  });
}
