/** Invoice flows: create (with double-financing anomaly handling), summaries, listing, detail. */
import { readFileSync } from 'node:fs';
import {
  LedgerError, computePricing, daysBetween, type BuyerScore, type CreateInvoiceRequest, type Invoice, type InvoiceDetail, type InvoicePrivateDetails,
  type InvoiceStatus, type InvoiceSummary, type InvoiceWithMeta, type Role,
} from '@billbridge/shared';
import { sha256Hex } from '@billbridge/shared/hashing';
import type { UploadedFile } from '@prisma/client';
import type { AuthUser } from '../auth/hooks.js';
import { HttpError, type AppContext } from '../context.js';
import { setState } from '../db.js';
import { callerFor, operatorCaller } from '../ledger/identity.js';
import { activeReservedUnits } from '../upi/service.js';
import { recordAnomalyFor } from './anomaly.js';
import { UserDirectory } from './users.js';

export const STATE_LAST_CREATED = 'lastCreatedInvoiceId';
export const STATE_LAST_CREATE_REQUEST = 'lastCreateRequest';
export const STATE_LAST_UPLOAD_PREFIX = 'lastUpload:';

export interface CreateOptions {
  /** Override the file bytes/hash (attack simulations). */
  fileOverride?: { hash: string; bytes?: Buffer };
  /** Record the request as "last created" for the attack endpoint (default true). */
  remember?: boolean;
}

export async function loadOwnedFile(ctx: AppContext, user: AuthUser, fileId: string): Promise<UploadedFile> {
  const file = await ctx.db.uploadedFile.findUnique({ where: { id: fileId } });
  if (!file || file.ownerId !== user.id) throw new HttpError(404, 'ERR_NOT_FOUND', `uploaded file ${fileId} not found for this user`, { fileId });
  return file;
}

export async function createInvoice(ctx: AppContext, user: AuthUser, body: CreateInvoiceRequest, opts: CreateOptions = {}): Promise<InvoiceWithMeta> {
  const file = await loadOwnedFile(ctx, user, body.fileId);
  const fileHash = opts.fileOverride?.hash ?? file.fileHash;
  const privateDetails: InvoicePrivateDetails = {
    supplierGstin: body.supplierGstin, buyerGstin: body.buyerGstin, invoiceNumber: body.invoiceNumber, lineItems: body.lineItems, fileHash,
    extractedJson: file.extractionJson,
  };
  const log = ctx.log.child({ userId: user.id, participantId: user.participantId, invoiceNumber: body.invoiceNumber });
  try {
    const r = await ctx.ledger.createInvoice(callerFor(user), user.participantId, body.buyerId, body.faceValuePaise, body.issueDate, body.dueDate, privateDetails);
    log.info({ invoiceId: r.data.invoiceId, txId: r.txId, blockNumber: r.blockNumber }, 'invoice tokenized');
    if (opts.remember !== false) {
      await setState(ctx.db, STATE_LAST_CREATED, r.data.invoiceId);
      await setState(ctx.db, STATE_LAST_CREATE_REQUEST, JSON.stringify({ userId: user.id, body }));
    }
    return { invoice: r.data, tx: { txId: r.txId, blockNumber: r.blockNumber, timestamp: r.timestamp } };
  } catch (e) {
    if (e instanceof LedgerError) {
      const existingInvoiceId = typeof e.details['existingInvoiceId'] === 'string' ? (e.details['existingInvoiceId'] as string)
        : typeof e.details['invoiceId'] === 'string' ? (e.details['invoiceId'] as string) : '';
      const rec = await recordAnomalyFor(ctx, e, user.participantId, existingInvoiceId);
      if (rec) {
        log.warn({ errorCode: e.code, guard: rec.guard, anomalyTxId: rec.txId, existingInvoiceId }, 'invoice rejected by double-financing guard');
        throw new LedgerError(e.code, e.message, { ...e.details, existingInvoiceId: existingInvoiceId || e.details['existingInvoiceId'], anomalyTxId: rec.txId, anomalyKind: rec.kind, guardLabel: rec.guard });
      }
    }
    throw e;
  }
}

export function fileBytes(file: UploadedFile): Buffer { return readFileSync(file.path); }
export function saltedHash(bytes: Buffer, salt: number): string { return sha256Hex(Buffer.concat([bytes, Buffer.from([salt & 0xff])])); }

// ───────────── reads ─────────────
const MARKETPLACE: InvoiceStatus[] = ['LISTED', 'PARTIALLY_FUNDED'];

export async function allInvoices(ctx: AppContext): Promise<Invoice[]> {
  const out: Invoice[] = [];
  let bookmark = '';
  for (let i = 0; i < 50; i++) {
    const page = await ctx.ledger.listAllInvoices(operatorCaller(), 500, bookmark);
    out.push(...page.items);
    if (!page.nextBookmark) break;
    bookmark = page.nextBookmark;
  }
  return out;
}

export class SummaryBuilder {
  private users: UserDirectory;
  private scores = new Map<string, BuyerScore>();
  constructor(private readonly ctx: AppContext) { this.users = new UserDirectory(ctx); }
  async score(buyerId: string): Promise<BuyerScore> {
    const c = this.scores.get(buyerId);
    if (c) return c;
    const s = await this.ctx.ledger.getBuyerScore(operatorCaller(), buyerId);
    this.scores.set(buyerId, s);
    return s;
  }
  async build(inv: Invoice): Promise<InvoiceSummary> {
    const reserved = MARKETPLACE.includes(inv.status) ? await activeReservedUnits(this.ctx.db, inv.invoiceId) : 0;
    const score = await this.score(inv.buyerId);
    return {
      ...inv,
      supplierName: await this.users.name(inv.supplierId),
      buyerName: await this.users.name(inv.buyerId),
      buyerScore: score.score,
      availableUnits: Math.max(0, inv.totalUnits - inv.unitsSold - reserved),
      reservedUnits: reserved,
    };
  }
}

export interface ListQuery { status?: InvoiceStatus; supplierId?: string; buyerId?: string; marketplace?: boolean; pageSize: number; bookmark: string }

export async function listInvoices(ctx: AppContext, user: AuthUser, q: ListQuery): Promise<{ items: InvoiceSummary[]; nextBookmark: string | null }> {
  let items = await allInvoices(ctx);
  if (q.marketplace) items = items.filter((i) => MARKETPLACE.includes(i.status));
  else if (q.status) items = items.filter((i) => i.status === q.status);
  let supplierId = q.supplierId; let buyerId = q.buyerId;
  // MSME / BUYER default to their own invoices unless they ask for the marketplace or an explicit filter.
  if (!q.marketplace && !q.status && user.role === 'MSME' && !supplierId) supplierId = user.participantId;
  if (!q.marketplace && !q.status && user.role === 'BUYER' && !buyerId) buyerId = user.participantId;
  if (supplierId) items = items.filter((i) => i.supplierId === supplierId);
  if (buyerId) items = items.filter((i) => i.buyerId === buyerId);
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const start = q.bookmark ? items.findIndex((i) => i.invoiceId === q.bookmark) + 1 : 0;
  const slice = items.slice(start, start + q.pageSize);
  const b = new SummaryBuilder(ctx);
  const summaries: InvoiceSummary[] = [];
  for (const inv of slice) summaries.push(await b.build(inv));
  const last = slice[slice.length - 1];
  return { items: summaries, nextBookmark: start + q.pageSize < items.length && last ? last.invoiceId : null };
}

export async function getInvoiceDetail(ctx: AppContext, user: AuthUser, invoiceId: string): Promise<InvoiceDetail> {
  const caller = callerFor(user);
  const inv = await ctx.ledger.getInvoice(caller, invoiceId);
  const b = new SummaryBuilder(ctx);
  const summary = await b.build(inv);
  let privateDetails: InvoicePrivateDetails | null = null;
  let privateAccess: InvoiceDetail['privateAccess'] = 'GRANTED';
  try {
    privateDetails = await ctx.ledger.getInvoicePrivateDetails(caller, invoiceId);
  } catch (e) {
    if (e instanceof LedgerError && (e.code === 'ERR_UNAUTHORIZED_ROLE' || e.code === 'ERR_NOT_FOUND')) {
      privateAccess = (user.role as Role) === 'REGULATOR' || user.mspId === 'Org3MSP' ? 'DENIED_ORG' : 'DENIED_PARTICIPANT';
    } else throw e;
  }
  const pricing = inv.annualizedYieldBps > 0 || inv.discountBps > 0 ? computePricing(inv.unitFaceValuePaise, inv.discountBps, Math.max(1, inv.tenorDays)) : null;
  const holdings = await ctx.ledger.getHoldingsByInvoice(caller, invoiceId);
  const payments = await ctx.ledger.getPaymentsByInvoice(caller, invoiceId);
  const supplierPayoutElapsedSeconds = inv.supplierPaidAt ? Math.max(0, Math.floor((Date.parse(inv.supplierPaidAt) - Date.parse(inv.createdAt)) / 1000)) : null;
  return { invoice: summary, privateDetails, privateAccess, pricing, buyerScore: await b.score(inv.buyerId), holdings, payments, supplierPayoutElapsedSeconds };
}

export function tenorFrom(inv: Invoice, now: string): number { return Math.max(1, daysBetween(now, inv.dueDate)); }
