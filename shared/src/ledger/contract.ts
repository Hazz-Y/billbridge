/**
 * BillBridge contract — TypeScript port of chaincode/billbridge (Go).
 * Same function names, validation ORDER, error codes, events and state machine.
 * Proven equivalent via shared/test-vectors run by both `go test` and Vitest.
 *
 * Validation order in every mutating function:
 *   (1) caller MSP + role + identity binding  (2) caller participant exists, KYC approved, not frozen
 *   (3) argument validation  (4) state mutation  (5) sub-events  (6) structured JSON result
 */
import { createHash } from 'node:crypto';
import { invoiceContentString, invoiceIdentityString } from '../canonical.js';
import { addDays, daysBetween, epochToIso, isIsoDate, toEpochSeconds } from '../dates.js';
import {
  INVOICE_STATUSES, INVOICE_TRANSITIONS, KYC_STATUSES, ROLES, ROLE_MSP, ANOMALY_KINDS,
  type InvoiceStatus, type Role, type AnomalyKind,
} from '../enums.js';
import { LedgerError } from '../errors.js';
import type {
  AnomalyRecord, AuditEntry, BuyerScore, HistoryEntry, Holding, Invoice, InvoicePrivateDetails, LedgerConfig,
  Page, Participant, PaymentRecord, PlatformStats, LineItem,
} from '../domain.js';
import { DEFAULT_LEDGER_CONFIG } from '../domain.js';
import type { Clock, DefaultResult, InvestResult, ReleaseResult, RepaymentResult } from '../ledger-api.js';
import { computeBuyerScore } from '../score.js';
import { computePricing } from '../pricing.js';
import { computeWaterfall } from '../waterfall.js';
import { mulDivFloor } from '../money.js';
import type { ChaincodeStub } from './stub.js';

export const COLLECTION_INVOICE_DETAILS = 'collectionInvoiceDetails';
const PRIVATE_COLLECTION_MSPS = new Set(['Org1MSP', 'Org2MSP']);

export const KEYS = {
  config: 'CONFIG',
  clock: 'CLOCK_OFFSET_SECONDS',
  participant: (id: string) => `PART~${id}`,
  invoice: (id: string) => `INV~${id}`,
  content: (h: string) => `CONTENT~${h}`,
  file: (h: string) => `FILE~${h}`,
  status: (s: string, id: string) => `STATUS~${s}~${id}`,
  supplier: (s: string, id: string) => `SUP~${s}~${id}`,
  buyer: (b: string, id: string) => `BUY~${b}~${id}`,
  holding: (inv: string, holder: string) => `HOLD~${inv}~${holder}`,
  holdingByInvestor: (holder: string, inv: string) => `HOLDINV~${holder}~${inv}`,
  payment: (ref: string) => `PAY~${ref}`,
  paymentByInvoice: (inv: string, ref: string) => `PAYINV~${inv}~${ref}`,
  score: (b: string) => `SCORE~${b}`,
  anomaly: (id: string) => `ANOM~${id}`,
  audit: (ts: string, tx: string) => `AUDIT~${ts}~${tx}`,
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function parseInt64(s: string, label: string, opts: { min?: number; max?: number } = {}): number {
  if (!/^-?\d+$/.test(s.trim())) throw new LedgerError('ERR_INVALID_ARGUMENT', `${label} must be an integer, got "${s}"`, { field: label });
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new LedgerError('ERR_INVALID_ARGUMENT', `${label} out of range`, { field: label });
  if (opts.min !== undefined && n < opts.min) throw new LedgerError('ERR_INVALID_ARGUMENT', `${label} must be >= ${opts.min}`, { field: label, value: n });
  if (opts.max !== undefined && n > opts.max) throw new LedgerError('ERR_INVALID_ARGUMENT', `${label} must be <= ${opts.max}`, { field: label, value: n });
  return n;
}
function requireNonEmpty(s: string, label: string): string {
  if (!s || s.trim() === '') throw new LedgerError('ERR_INVALID_ARGUMENT', `${label} is required`, { field: label });
  return s;
}
function parseJSON<T>(s: string, label: string): T {
  try { return JSON.parse(s) as T; } catch { throw new LedgerError('ERR_INVALID_ARGUMENT', `${label} must be valid JSON`, { field: label }); }
}
function cmp(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export class BillBridgeContract {
  constructor(private readonly stub: ChaincodeStub) {}

  // ───────────────────────── helpers ─────────────────────────
  private config(): LedgerConfig {
    const raw = this.stub.getState(KEYS.config);
    if (!raw) throw new LedgerError('ERR_INVALID_ARGUMENT', 'ledger not initialised (call InitLedger)');
    return JSON.parse(raw) as LedgerConfig;
  }
  /** now = tx timestamp + demo clock offset (deterministic across endorsers). */
  private now(): string {
    const offset = Number(this.stub.getState(KEYS.clock) ?? '0');
    return epochToIso(toEpochSeconds(this.stub.getTxTimestamp()) + offset);
  }
  private get<T>(key: string): T | undefined {
    const raw = this.stub.getState(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  private put(key: string, value: unknown): void { this.stub.putState(key, JSON.stringify(value)); }
  private list<T>(prefix: string): T[] { return this.stub.getStateByPrefix(prefix).map((kv) => JSON.parse(kv.value) as T); }

  private paginate<T>(items: T[], pageSize: number, bookmark: string, keyOf: (t: T) => string): Page<T> {
    const start = bookmark ? items.findIndex((i) => keyOf(i) === bookmark) + 1 : 0;
    const slice = items.slice(start, start + pageSize);
    const last = slice[slice.length - 1];
    const nextBookmark = start + pageSize < items.length && last ? keyOf(last) : null;
    return { items: slice, nextBookmark };
  }

  private requireRole(allowed: Role[]): CallerIdentityChecked {
    const c = this.stub.getCaller();
    if (!(ROLES as readonly string[]).includes(c.role)) throw new LedgerError('ERR_UNAUTHORIZED_ROLE', `unknown role attribute "${c.role}"`);
    if (ROLE_MSP[c.role] !== c.mspId) {
      throw new LedgerError('ERR_UNAUTHORIZED_ROLE', `role ${c.role} must be enrolled under ${ROLE_MSP[c.role]}, caller is ${c.mspId}`, { role: c.role, mspId: c.mspId });
    }
    if (!allowed.includes(c.role)) {
      throw new LedgerError('ERR_UNAUTHORIZED_ROLE', `function requires role ${allowed.join('|')}, caller is ${c.role}`, { required: allowed, actual: c.role });
    }
    return c;
  }
  /** Identity binding: the caller can never act as another participant. */
  private bind(c: CallerIdentityChecked, participantIdArg: string, label: string): void {
    if (c.participantId !== participantIdArg) {
      throw new LedgerError('ERR_IDENTITY_MISMATCH', `caller ${c.participantId} cannot act as ${label} ${participantIdArg}`, { caller: c.participantId, [label]: participantIdArg });
    }
  }
  private participant(id: string): Participant {
    const p = this.get<Participant>(KEYS.participant(id));
    if (!p) throw new LedgerError('ERR_PARTICIPANT_NOT_FOUND', `participant ${id} not found`, { participantId: id });
    return p;
  }
  /** KYC approved + not frozen. Operators: frozen check only (KYC not applicable). */
  private requireActive(c: CallerIdentityChecked): Participant {
    const p = this.participant(c.participantId);
    if (p.role !== c.role) throw new LedgerError('ERR_UNAUTHORIZED_ROLE', `participant ${p.id} is registered as ${p.role}, certificate says ${c.role}`);
    if (p.frozen) throw new LedgerError('ERR_PARTICIPANT_FROZEN', `participant ${p.id} is frozen: ${p.frozenReason ?? ''}`.trim(), { participantId: p.id, reason: p.frozenReason ?? '' });
    if (p.role !== 'OPERATOR' && p.role !== 'REGULATOR' && p.kycStatus !== 'APPROVED') {
      throw new LedgerError('ERR_KYC_NOT_APPROVED', `participant ${p.id} KYC status is ${p.kycStatus}; must be APPROVED`, { participantId: p.id, kycStatus: p.kycStatus });
    }
    return p;
  }
  private invoice(id: string): Invoice {
    const inv = this.get<Invoice>(KEYS.invoice(id));
    if (!inv) throw new LedgerError('ERR_NOT_FOUND', `invoice ${id} not found`, { invoiceId: id });
    return inv;
  }
  private transition(inv: Invoice, to: InvoiceStatus, fn: string): void {
    if (!INVOICE_TRANSITIONS[inv.status].includes(to)) {
      throw new LedgerError('ERR_INVALID_TRANSITION', `${fn}: invoice is ${inv.status}; cannot move to ${to}`, { invoiceId: inv.invoiceId, from: inv.status, to });
    }
    if (inv.status !== to) {
      this.stub.delState(KEYS.status(inv.status, inv.invoiceId));
      this.stub.putState(KEYS.status(to, inv.invoiceId), inv.invoiceId);
      this.stub.addEvent({ type: 'INVOICE_STATUS_CHANGED', payload: { invoiceId: inv.invoiceId, from: inv.status, to } });
    }
    inv.status = to;
    inv.updatedAt = this.now();
  }
  private saveInvoice(inv: Invoice): void { this.put(KEYS.invoice(inv.invoiceId), inv); }
  private audit(fn: string, c: CallerIdentityChecked, invoiceId?: string): void {
    const entry: AuditEntry = { txId: this.stub.getTxId(), blockNumber: this.stub.getBlockNumber(), timestamp: this.now(), fn, actorId: c.participantId, actorRole: c.role, invoiceId };
    this.put(KEYS.audit(entry.timestamp, entry.txId), entry);
  }
  private scoreFor(buyerId: string): BuyerScore {
    return this.get<BuyerScore>(KEYS.score(buyerId)) ?? { buyerId, settledOnTime: 0, settledLate: 0, defaulted: 0, score: 50, lastUpdated: '' };
  }
  private saveScore(s: BuyerScore, reason: string): BuyerScore {
    s.score = computeBuyerScore(s.settledOnTime, s.settledLate, s.defaulted);
    s.lastUpdated = this.now();
    this.put(KEYS.score(s.buyerId), s);
    this.stub.addEvent({ type: 'SCORE_UPDATED', payload: { buyerId: s.buyerId, score: s.score, settledOnTime: s.settledOnTime, settledLate: s.settledLate, defaulted: s.defaulted, reason } });
    return s;
  }
  private requireDemoMode(): LedgerConfig {
    const cfg = this.config();
    if (!cfg.demoMode) throw new LedgerError('ERR_DEMO_MODE_DISABLED', 'demo functions are disabled (chaincode init param demoMode=false)');
    return cfg;
  }

  // ───────────────────────── init ─────────────────────────
  /** InitLedger(configJSON) — idempotent; creates the bootstrap operator participant. */
  InitLedger(configJson: string): LedgerConfig {
    const existing = this.stub.getState(KEYS.config);
    if (existing) return JSON.parse(existing) as LedgerConfig;
    const partial = configJson ? parseJSON<Partial<LedgerConfig>>(configJson, 'config') : {};
    const cfg: LedgerConfig = { ...DEFAULT_LEDGER_CONFIG, ...partial };
    if (cfg.unitFaceValuePaise <= 0) throw new LedgerError('ERR_INVALID_ARGUMENT', 'unitFaceValuePaise must be > 0');
    this.put(KEYS.config, cfg);
    this.stub.putState(KEYS.clock, '0');
    const now = this.now();
    const op: Participant = { id: cfg.bootstrapOperatorId, role: 'OPERATOR', orgMsp: 'Org1MSP', kycStatus: 'APPROVED', kycDocHash: '', perInvoiceCapPaise: 0, frozen: false, createdAt: now, updatedAt: now };
    this.put(KEYS.participant(op.id), op);
    this.stub.addEvent({ type: 'PARTICIPANT_REGISTERED', payload: { participantId: op.id, role: op.role, bootstrap: true } });
    return cfg;
  }

  // ───────────────────────── participants ─────────────────────────
  RegisterParticipant(id: string, role: string, orgMsp: string, perInvoiceCapPaise: string): Participant {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    requireNonEmpty(id, 'id');
    if (!(ROLES as readonly string[]).includes(role)) throw new LedgerError('ERR_INVALID_ARGUMENT', `role must be one of ${ROLES.join('|')}`, { field: 'role', value: role });
    const r = role as Role;
    if (ROLE_MSP[r] !== orgMsp) throw new LedgerError('ERR_INVALID_ARGUMENT', `role ${r} must belong to ${ROLE_MSP[r]}, got ${orgMsp}`, { field: 'orgMsp' });
    const cap = parseInt64(perInvoiceCapPaise, 'perInvoiceCapPaise', { min: 0 });
    if (this.stub.getState(KEYS.participant(id))) throw new LedgerError('ERR_DUPLICATE_PARTICIPANT', `participant ${id} already registered`, { participantId: id });
    const now = this.now();
    const p: Participant = { id, role: r, orgMsp, kycStatus: 'PENDING', kycDocHash: '', perInvoiceCapPaise: cap, frozen: false, createdAt: now, updatedAt: now };
    this.put(KEYS.participant(id), p);
    this.stub.addEvent({ type: 'PARTICIPANT_REGISTERED', payload: { participantId: id, role: r, orgMsp, perInvoiceCapPaise: cap } });
    this.audit('RegisterParticipant', c);
    return p;
  }

  SetKycStatus(participantId: string, status: string, kycDocHash: string): Participant {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    if (!(KYC_STATUSES as readonly string[]).includes(status)) throw new LedgerError('ERR_INVALID_ARGUMENT', `status must be one of ${KYC_STATUSES.join('|')}`, { field: 'status' });
    const p = this.participant(participantId);
    const from = p.kycStatus;
    p.kycStatus = status as Participant['kycStatus'];
    if (kycDocHash) p.kycDocHash = kycDocHash;
    p.updatedAt = this.now();
    this.put(KEYS.participant(participantId), p);
    this.stub.addEvent({ type: 'KYC_UPDATED', payload: { participantId, from, to: status, kycDocHash: p.kycDocHash } });
    this.audit('SetKycStatus', c);
    return p;
  }

  FreezeParticipant(participantId: string, reason: string): Participant {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const p = this.participant(participantId);
    p.frozen = true;
    p.frozenReason = reason || 'frozen by operator';
    p.updatedAt = this.now();
    this.put(KEYS.participant(participantId), p);
    this.stub.addEvent({ type: 'PARTICIPANT_FROZEN', payload: { participantId, reason: p.frozenReason } });
    this.audit('FreezeParticipant', c);
    return p;
  }

  UnfreezeParticipant(participantId: string): Participant {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const p = this.participant(participantId);
    p.frozen = false;
    delete p.frozenReason;
    p.updatedAt = this.now();
    this.put(KEYS.participant(participantId), p);
    this.stub.addEvent({ type: 'PARTICIPANT_UNFROZEN', payload: { participantId } });
    this.audit('UnfreezeParticipant', c);
    return p;
  }

  // ───────────────────────── invoice lifecycle ─────────────────────────
  CreateInvoice(supplierId: string, buyerId: string, faceValuePaise: string, issueDate: string, dueDate: string, privateDetailsJson: string): Invoice {
    const c = this.requireRole(['MSME']);
    this.bind(c, supplierId, 'supplierId');
    this.requireActive(c);
    const cfg = this.config();
    const face = parseInt64(faceValuePaise, 'faceValuePaise', { min: 1 });
    if (!isIsoDate(issueDate)) throw new LedgerError('ERR_INVALID_ARGUMENT', 'issueDate must be YYYY-MM-DD', { field: 'issueDate' });
    if (!isIsoDate(dueDate)) throw new LedgerError('ERR_INVALID_ARGUMENT', 'dueDate must be YYYY-MM-DD', { field: 'dueDate' });
    if (toEpochSeconds(dueDate) <= toEpochSeconds(issueDate)) throw new LedgerError('ERR_INVALID_ARGUMENT', 'dueDate must be after issueDate', { field: 'dueDate' });
    const pd = parseJSON<InvoicePrivateDetails>(privateDetailsJson, 'privateDetails');
    requireNonEmpty(pd.supplierGstin ?? '', 'privateDetails.supplierGstin');
    requireNonEmpty(pd.buyerGstin ?? '', 'privateDetails.buyerGstin');
    requireNonEmpty(pd.invoiceNumber ?? '', 'privateDetails.invoiceNumber');
    requireNonEmpty(pd.fileHash ?? '', 'privateDetails.fileHash');
    if (!Array.isArray(pd.lineItems)) throw new LedgerError('ERR_INVALID_ARGUMENT', 'privateDetails.lineItems must be an array', { field: 'lineItems' });
    const lineItems: LineItem[] = pd.lineItems;
    if (face % cfg.unitFaceValuePaise !== 0) {
      throw new LedgerError('ERR_FACE_NOT_UNIT_MULTIPLE', `faceValuePaise ${face} is not a multiple of unit ${cfg.unitFaceValuePaise}`, { faceValuePaise: face, unitFaceValuePaise: cfg.unitFaceValuePaise });
    }
    const buyer = this.participant(buyerId);
    if (buyer.role !== 'BUYER') throw new LedgerError('ERR_INVALID_ARGUMENT', `${buyerId} is not a BUYER`, { buyerId });
    if (buyer.kycStatus !== 'APPROVED') throw new LedgerError('ERR_KYC_NOT_APPROVED', `buyer ${buyerId} KYC status is ${buyer.kycStatus}`, { participantId: buyerId });

    // ── double-financing guards (spec 4.6) — identity, content, file ──
    const invoiceId = sha256(invoiceIdentityString(pd.supplierGstin, pd.buyerGstin, pd.invoiceNumber));
    const contentHash = sha256(invoiceContentString(pd.supplierGstin, pd.buyerGstin, issueDate, face, lineItems));
    const existing = this.get<Invoice>(KEYS.invoice(invoiceId));
    if (existing) {
      throw new LedgerError('ERR_DUPLICATE_INVOICE_ID',
        `Invoice ${pd.invoiceNumber} from ${existing.supplierId} to ${existing.buyerId} is already tokenized (status: ${existing.status}, tx ${(existing.createdTxId ?? '').slice(0, 12)}…)`,
        { guard: 'IDENTITY', invoiceId, invoiceNumber: pd.invoiceNumber, existingStatus: existing.status, existingTxId: existing.createdTxId ?? '' });
    }
    const contentClash = this.stub.getState(KEYS.content(contentHash));
    if (contentClash) {
      const other = this.invoice(contentClash);
      throw new LedgerError('ERR_DUPLICATE_INVOICE_CONTENT',
        `Invoice content (same supplier, buyer, date, amount and line items) already tokenized as invoice ${contentClash.slice(0, 12)}… (status: ${other.status}); only the invoice number differs`,
        { guard: 'CONTENT', contentHash, existingInvoiceId: contentClash, existingStatus: other.status, existingTxId: other.createdTxId ?? '' });
    }
    const fileClash = this.stub.getState(KEYS.file(pd.fileHash));
    if (fileClash) {
      const other = this.invoice(fileClash);
      throw new LedgerError('ERR_DUPLICATE_FILE',
        `This exact PDF (sha256 ${pd.fileHash.slice(0, 12)}…) was already uploaded for invoice ${fileClash.slice(0, 12)}… (status: ${other.status})`,
        { guard: 'FILE', fileHash: pd.fileHash, existingInvoiceId: fileClash, existingStatus: other.status, existingTxId: other.createdTxId ?? '' });
    }

    const now = this.now();
    const inv: Invoice = {
      invoiceId, contentHash, supplierId, buyerId, faceValuePaise: face, issueDate, dueDate,
      unitFaceValuePaise: cfg.unitFaceValuePaise, discountBps: 0, tenorDays: 0, pricePerUnitPaise: 0, annualizedYieldBps: 0,
      totalUnits: face / cfg.unitFaceValuePaise, unitsSold: 0, minFundingUnits: 0, status: 'DRAFT',
      createdAt: now, updatedAt: now, createdTxId: this.stub.getTxId(),
    };
    this.saveInvoice(inv);
    this.stub.putState(KEYS.content(contentHash), invoiceId);
    this.stub.putState(KEYS.file(pd.fileHash), invoiceId);
    this.stub.putState(KEYS.status('DRAFT', invoiceId), invoiceId);
    this.stub.putState(KEYS.supplier(supplierId, invoiceId), invoiceId);
    this.stub.putState(KEYS.buyer(buyerId, invoiceId), invoiceId);
    const priv: InvoicePrivateDetails = { ...pd, invoiceId, lineItems, extractedJson: pd.extractedJson ?? '' };
    this.stub.putPrivateData(COLLECTION_INVOICE_DETAILS, KEYS.invoice(invoiceId), JSON.stringify(priv));
    this.stub.addEvent({ type: 'INVOICE_CREATED', payload: { invoiceId, supplierId, buyerId, faceValuePaise: face, totalUnits: inv.totalUnits, dueDate, contentHash, fileHash: pd.fileHash } });
    this.stub.addEvent({ type: 'INVOICE_STATUS_CHANGED', payload: { invoiceId, from: null, to: 'DRAFT' } });
    this.audit('CreateInvoice', c, invoiceId);
    return inv;
  }

  BuyerAcceptInvoice(invoiceId: string): Invoice {
    const c = this.requireRole(['BUYER']);
    this.requireActive(c);
    const inv = this.invoice(invoiceId);
    this.bind(c, inv.buyerId, 'buyerId');
    this.transition(inv, 'BUYER_ACCEPTED', 'BuyerAcceptInvoice');
    this.saveInvoice(inv);
    this.stub.addEvent({ type: 'INVOICE_ACCEPTED', payload: { invoiceId, buyerId: c.participantId } });
    this.audit('BuyerAcceptInvoice', c, invoiceId);
    return inv;
  }

  ListInvoice(invoiceId: string, discountBps: string, minFundingUnits: string): Invoice {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const cfg = this.config();
    const bps = parseInt64(discountBps, 'discountBps');
    const minUnits = parseInt64(minFundingUnits, 'minFundingUnits');
    const inv = this.invoice(invoiceId);
    if (bps < cfg.minDiscountBps || bps > cfg.maxDiscountBps) {
      throw new LedgerError('ERR_DISCOUNT_OUT_OF_RANGE', `discountBps ${bps} outside [${cfg.minDiscountBps}, ${cfg.maxDiscountBps}]`, { discountBps: bps, min: cfg.minDiscountBps, max: cfg.maxDiscountBps });
    }
    if (minUnits < 1 || minUnits > inv.totalUnits) {
      throw new LedgerError('ERR_INVALID_ARGUMENT', `minFundingUnits must be within [1, ${inv.totalUnits}]`, { field: 'minFundingUnits', totalUnits: inv.totalUnits });
    }
    const now = this.now();
    const tenor = Math.max(1, daysBetween(now, inv.dueDate));
    const pricing = computePricing(inv.unitFaceValuePaise, bps, tenor);
    this.transition(inv, 'LISTED', 'ListInvoice');
    inv.discountBps = bps;
    inv.tenorDays = tenor;
    inv.pricePerUnitPaise = pricing.pricePerUnitPaise;
    inv.annualizedYieldBps = pricing.annualizedYieldBps;
    inv.minFundingUnits = minUnits;
    inv.listedAt = now;
    this.saveInvoice(inv);
    this.stub.addEvent({ type: 'INVOICE_LISTED', payload: { invoiceId, discountBps: bps, tenorDays: tenor, pricePerUnitPaise: inv.pricePerUnitPaise, annualizedYieldBps: inv.annualizedYieldBps, minFundingUnits: minUnits, totalUnits: inv.totalUnits } });
    this.audit('ListInvoice', c, invoiceId);
    return inv;
  }

  CancelInvoice(invoiceId: string, reason: string): Invoice {
    const c = this.requireRole(['MSME', 'OPERATOR']);
    this.requireActive(c);
    const inv = this.invoice(invoiceId);
    if (c.role === 'MSME') {
      this.bind(c, inv.supplierId, 'supplierId');
      if (inv.status !== 'DRAFT') throw new LedgerError('ERR_INVALID_TRANSITION', `MSME may cancel only DRAFT invoices; invoice is ${inv.status}`, { invoiceId, from: inv.status, to: 'CANCELLED' });
    } else {
      if (inv.status !== 'LISTED' || inv.unitsSold !== 0) throw new LedgerError('ERR_INVALID_TRANSITION', `operator may cancel only LISTED invoices with no units sold; invoice is ${inv.status} with ${inv.unitsSold} sold`, { invoiceId, from: inv.status, to: 'CANCELLED' });
    }
    this.transition(inv, 'CANCELLED', 'CancelInvoice');
    inv.cancelReason = reason;
    this.saveInvoice(inv);
    // NOTE: CONTENT~ and FILE~ index keys are deliberately kept: a cancelled invoice's identity is burned.
    this.stub.addEvent({ type: 'INVOICE_CANCELLED', payload: { invoiceId, reason, by: c.participantId } });
    this.audit('CancelInvoice', c, invoiceId);
    return inv;
  }

  // ───────────────────────── investment & settlement ─────────────────────────
  Invest(invoiceId: string, investorId: string, units: string, upiRef: string): InvestResult {
    const c = this.requireRole(['INVESTOR']);
    this.bind(c, investorId, 'investorId');
    const investor = this.requireActive(c);
    requireNonEmpty(upiRef, 'upiRef');
    const n = parseInt64(units, 'units', { min: 1 });
    const inv = this.invoice(invoiceId);
    // idempotency: same upiRef → return original result, no state change
    const existingPay = this.get<PaymentRecord>(KEYS.payment(upiRef));
    if (existingPay) {
      const h = this.get<Holding>(KEYS.holding(existingPay.invoiceId, existingPay.fromId));
      if (!h) throw new LedgerError('ERR_INVALID_ARGUMENT', `upiRef ${upiRef} already used by a non-funding payment`, { upiRef });
      return { invoice: this.invoice(existingPay.invoiceId), holding: h, payment: existingPay, replayed: true };
    }
    if (inv.status !== 'LISTED' && inv.status !== 'PARTIALLY_FUNDED') {
      throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; investments are accepted only while LISTED or PARTIALLY_FUNDED`, { invoiceId, from: inv.status });
    }
    const available = inv.totalUnits - inv.unitsSold;
    if (n > available) throw new LedgerError('ERR_UNITS_UNAVAILABLE', `requested ${n} units but only ${available} available`, { invoiceId, requested: n, available });
    const amount = n * inv.pricePerUnitPaise;
    const holdingKey = KEYS.holding(invoiceId, investorId);
    const holding: Holding = this.get<Holding>(holdingKey) ?? { invoiceId, holderId: investorId, units: 0, costPaise: 0, upiRefs: [], acquiredAt: this.now(), receivedPaise: 0 };
    if (investor.perInvoiceCapPaise > 0 && holding.costPaise + amount > investor.perInvoiceCapPaise) {
      throw new LedgerError('ERR_CAP_EXCEEDED', `cumulative investment ${holding.costPaise + amount} paise would exceed your per-invoice cap of ${investor.perInvoiceCapPaise} paise`, { invoiceId, investorId, capPaise: investor.perInvoiceCapPaise, existingPaise: holding.costPaise, requestedPaise: amount });
    }
    const now = this.now();
    holding.units += n;
    holding.costPaise += amount;
    holding.upiRefs.push(upiRef);
    this.put(holdingKey, holding);
    this.stub.putState(KEYS.holdingByInvestor(investorId, invoiceId), invoiceId);
    const payment: PaymentRecord = { upiRef, invoiceId, kind: 'FUNDING', fromId: investorId, toId: 'PLATFORM_ESCROW', amountPaise: amount, timestamp: now, txId: this.stub.getTxId() };
    this.put(KEYS.payment(upiRef), payment);
    this.stub.putState(KEYS.paymentByInvoice(invoiceId, upiRef), upiRef);
    inv.unitsSold += n;
    if (inv.unitsSold === inv.totalUnits) { this.transition(inv, 'FULLY_FUNDED', 'Invest'); inv.fundedAt = now; }
    else this.transition(inv, 'PARTIALLY_FUNDED', 'Invest');
    this.saveInvoice(inv);
    this.stub.addEvent({ type: 'INVESTMENT_MADE', payload: { invoiceId, investorId, units: n, amountPaise: amount, upiRef, unitsSold: inv.unitsSold, totalUnits: inv.totalUnits } });
    this.audit('Invest', c, invoiceId);
    return { invoice: inv, holding, payment, replayed: false };
  }

  ReleaseToSupplier(invoiceId: string, upiRef: string): ReleaseResult {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    requireNonEmpty(upiRef, 'upiRef');
    const inv = this.invoice(invoiceId);
    if (this.stub.getState(KEYS.payment(upiRef))) throw new LedgerError('ERR_INVALID_ARGUMENT', `upiRef ${upiRef} already used`, { upiRef });
    if (inv.status !== 'PARTIALLY_FUNDED' && inv.status !== 'FULLY_FUNDED') {
      throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; release requires PARTIALLY_FUNDED or FULLY_FUNDED`, { invoiceId, from: inv.status, to: 'SUPPLIER_PAID' });
    }
    if (inv.unitsSold < inv.minFundingUnits) {
      throw new LedgerError('ERR_BELOW_MIN_FUNDING', `only ${inv.unitsSold} of minimum ${inv.minFundingUnits} units funded`, { invoiceId, unitsSold: inv.unitsSold, minFundingUnits: inv.minFundingUnits });
    }
    const holdings = this.list<Holding>(`HOLD~${invoiceId}~`);
    const payout = holdings.reduce((s, h) => s + h.costPaise, 0);
    const now = this.now();
    this.transition(inv, 'SUPPLIER_PAID', 'ReleaseToSupplier');
    inv.supplierPaidAt = now;
    this.saveInvoice(inv);
    const payment: PaymentRecord = { upiRef, invoiceId, kind: 'SUPPLIER_PAYOUT', fromId: 'PLATFORM_ESCROW', toId: inv.supplierId, amountPaise: payout, timestamp: now, txId: this.stub.getTxId() };
    this.put(KEYS.payment(upiRef), payment);
    this.stub.putState(KEYS.paymentByInvoice(invoiceId, upiRef), upiRef);
    this.stub.addEvent({ type: 'SUPPLIER_PAID', payload: { invoiceId, supplierId: inv.supplierId, amountPaise: payout, upiRef, unitsSold: inv.unitsSold } });
    this.audit('ReleaseToSupplier', c, invoiceId);
    return { invoice: inv, payment };
  }

  RecordRepayment(invoiceId: string, upiRef: string, amountPaise: string): RepaymentResult {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const cfg = this.config();
    requireNonEmpty(upiRef, 'upiRef');
    const amount = parseInt64(amountPaise, 'amountPaise', { min: 1 });
    const inv = this.invoice(invoiceId);
    if (this.stub.getState(KEYS.payment(upiRef))) throw new LedgerError('ERR_INVALID_ARGUMENT', `upiRef ${upiRef} already used`, { upiRef });
    if (inv.status !== 'SUPPLIER_PAID' && inv.status !== 'LATE') {
      throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; repayment requires SUPPLIER_PAID or LATE`, { invoiceId, from: inv.status, to: 'SETTLED' });
    }
    if (amount !== inv.faceValuePaise) throw new LedgerError('ERR_AMOUNT_MISMATCH', `repayment ${amount} paise must equal face value ${inv.faceValuePaise} paise`, { invoiceId, expected: inv.faceValuePaise, actual: amount });
    const holdings = this.list<Holding>(`HOLD~${invoiceId}~`).sort((a, b) => cmp(a.holderId, b.holderId));
    const wf = computeWaterfall(amount, inv.unitsSold, inv.totalUnits, holdings.map((h) => ({ holderId: h.holderId, units: h.units })));
    const now = this.now();
    const repayment: PaymentRecord = { upiRef, invoiceId, kind: 'BUYER_REPAYMENT', fromId: inv.buyerId, toId: 'PLATFORM_ESCROW', amountPaise: amount, timestamp: now, txId: this.stub.getTxId() };
    this.put(KEYS.payment(upiRef), repayment);
    this.stub.putState(KEYS.paymentByInvoice(invoiceId, upiRef), upiRef);
    const distributions: PaymentRecord[] = [];
    wf.shares.forEach((s, i) => {
      const h = holdings[i];
      if (!h || h.holderId !== s.holderId) throw new LedgerError('ERR_INVALID_ARGUMENT', 'waterfall holder order mismatch');
      h.receivedPaise = s.sharePaise;
      this.put(KEYS.holding(invoiceId, h.holderId), h);
      const ref = `${upiRef}-D${i}`;
      const d: PaymentRecord = { upiRef: ref, invoiceId, kind: 'INVESTOR_DISTRIBUTION', fromId: 'PLATFORM_ESCROW', toId: h.holderId, amountPaise: s.sharePaise, timestamp: now, txId: this.stub.getTxId() };
      this.put(KEYS.payment(ref), d);
      this.stub.putState(KEYS.paymentByInvoice(invoiceId, ref), ref);
      distributions.push(d);
      this.stub.addEvent({ type: 'DISTRIBUTION_PAID', payload: { invoiceId, holderId: h.holderId, units: h.units, costPaise: h.costPaise, amountPaise: s.sharePaise, upiRef: ref } });
    });
    let residual: PaymentRecord | null = null;
    if (wf.residualPaise > 0) {
      const ref = `${upiRef}-R`;
      residual = { upiRef: ref, invoiceId, kind: 'SUPPLIER_RESIDUAL', fromId: 'PLATFORM_ESCROW', toId: inv.supplierId, amountPaise: wf.residualPaise, timestamp: now, txId: this.stub.getTxId() };
      this.put(KEYS.payment(ref), residual);
      this.stub.putState(KEYS.paymentByInvoice(invoiceId, ref), ref);
    }
    const total = distributions.reduce((s, d) => s + d.amountPaise, 0) + (residual?.amountPaise ?? 0);
    if (total !== amount) throw new LedgerError('ERR_INVALID_ARGUMENT', `waterfall invariant violated ${total} != ${amount}`);
    // buyer score
    const lateThreshold = toEpochSeconds(addDays(inv.dueDate, cfg.graceDays));
    const onTime = toEpochSeconds(now) <= lateThreshold;
    const score = this.scoreFor(inv.buyerId);
    if (onTime) score.settledOnTime += 1; else score.settledLate += 1;
    const buyerScore = this.saveScore(score, onTime ? 'SETTLED_ON_TIME' : 'SETTLED_LATE');
    this.transition(inv, 'SETTLED', 'RecordRepayment');
    inv.settledAt = now;
    this.saveInvoice(inv);
    this.stub.addEvent({ type: 'REPAYMENT_RECORDED', payload: { invoiceId, buyerId: inv.buyerId, amountPaise: amount, upiRef, onTime, investorPoolPaise: wf.investorPoolPaise, residualPaise: wf.residualPaise, holders: distributions.length } });
    this.audit('RecordRepayment', c, invoiceId);
    return { invoice: inv, repayment, distributions, residual, buyerScore, onTime };
  }

  MarkLate(invoiceId: string): Invoice {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const cfg = this.config();
    const inv = this.invoice(invoiceId);
    if (inv.status !== 'SUPPLIER_PAID') throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; MarkLate requires SUPPLIER_PAID`, { invoiceId, from: inv.status, to: 'LATE' });
    const now = this.now();
    const threshold = addDays(inv.dueDate, cfg.graceDays);
    if (toEpochSeconds(now) <= toEpochSeconds(threshold)) {
      throw new LedgerError('ERR_NOT_YET_LATE', `grace period ends ${threshold}; simulated now is ${now}`, { invoiceId, dueDate: inv.dueDate, graceDays: cfg.graceDays, now });
    }
    this.transition(inv, 'LATE', 'MarkLate');
    this.saveInvoice(inv);
    this.stub.addEvent({ type: 'INVOICE_LATE', payload: { invoiceId, buyerId: inv.buyerId, dueDate: inv.dueDate } });
    this.audit('MarkLate', c, invoiceId);
    return inv;
  }

  MarkDefault(invoiceId: string): DefaultResult {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const cfg = this.config();
    const inv = this.invoice(invoiceId);
    if (inv.status !== 'SUPPLIER_PAID' && inv.status !== 'LATE') throw new LedgerError('ERR_INVALID_TRANSITION', `invoice is ${inv.status}; MarkDefault requires SUPPLIER_PAID or LATE`, { invoiceId, from: inv.status, to: 'DEFAULTED' });
    const now = this.now();
    const threshold = addDays(inv.dueDate, cfg.defaultDays);
    if (toEpochSeconds(now) <= toEpochSeconds(threshold)) {
      throw new LedgerError('ERR_NOT_YET_DEFAULT', `default window opens after ${threshold}; simulated now is ${now}`, { invoiceId, dueDate: inv.dueDate, defaultDays: cfg.defaultDays, now });
    }
    const holdings = this.list<Holding>(`HOLD~${invoiceId}~`).sort((a, b) => cmp(a.holderId, b.holderId));
    for (const h of holdings) {
      h.lossPaise = h.costPaise - h.receivedPaise;
      this.put(KEYS.holding(invoiceId, h.holderId), h);
    }
    const score = this.scoreFor(inv.buyerId);
    score.defaulted += 1;
    const buyerScore = this.saveScore(score, 'DEFAULTED');
    this.transition(inv, 'DEFAULTED', 'MarkDefault');
    this.saveInvoice(inv);
    this.stub.addEvent({ type: 'INVOICE_DEFAULTED', payload: { invoiceId, buyerId: inv.buyerId, lossPaise: holdings.reduce((s, h) => s + (h.lossPaise ?? 0), 0), holders: holdings.length } });
    this.audit('MarkDefault', c, invoiceId);
    return { invoice: inv, buyerScore, holdings };
  }

  // ───────────────────────── anomalies & demo ─────────────────────────
  RecordAnomaly(kind: string, actorId: string, invoiceRef: string, errorCode: string, detail: string): AnomalyRecord {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    if (!(ANOMALY_KINDS as readonly string[]).includes(kind)) throw new LedgerError('ERR_INVALID_ARGUMENT', `kind must be one of ${ANOMALY_KINDS.join('|')}`, { field: 'kind' });
    requireNonEmpty(errorCode, 'errorCode');
    const anomalyId = sha256(`${kind}|${invoiceRef}|${this.stub.getTxId()}`);
    const rec: AnomalyRecord = { anomalyId, kind: kind as AnomalyKind, actorId, invoiceRef: invoiceRef || undefined, errorCode, detail, recordedAt: this.now(), txId: this.stub.getTxId() };
    this.put(KEYS.anomaly(anomalyId), rec);
    this.stub.addEvent({ type: 'ANOMALY_RECORDED', payload: { ...rec } });
    this.audit('RecordAnomaly', c, invoiceRef || undefined);
    return rec;
  }

  AdvanceDemoClock(seconds: string): Clock {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    const cfg = this.requireDemoMode();
    const s = parseInt64(seconds, 'seconds');
    const current = Number(this.stub.getState(KEYS.clock) ?? '0');
    const next = current + s;
    this.stub.putState(KEYS.clock, String(next));
    const now = this.now();
    this.stub.addEvent({ type: 'CLOCK_ADVANCED', payload: { seconds: s, offsetSeconds: next, now } });
    this.audit('AdvanceDemoClock', c);
    return { now, offsetSeconds: next, demoMode: cfg.demoMode };
  }

  SeedBuyerHistory(buyerId: string, onTime: string, late: string, defaulted: string): BuyerScore {
    const c = this.requireRole(['OPERATOR']);
    this.requireActive(c);
    this.requireDemoMode();
    const b = this.participant(buyerId);
    if (b.role !== 'BUYER') throw new LedgerError('ERR_INVALID_ARGUMENT', `${buyerId} is not a BUYER`, { buyerId });
    const score: BuyerScore = { buyerId, settledOnTime: parseInt64(onTime, 'onTime', { min: 0 }), settledLate: parseInt64(late, 'late', { min: 0 }), defaulted: parseInt64(defaulted, 'defaulted', { min: 0 }), score: 50, lastUpdated: '' };
    const saved = this.saveScore(score, 'SEEDED');
    this.stub.addEvent({ type: 'BUYER_HISTORY_SEEDED', payload: { buyerId, onTime: saved.settledOnTime, late: saved.settledLate, defaulted: saved.defaulted, score: saved.score } });
    this.audit('SeedBuyerHistory', c);
    return saved;
  }

  // ───────────────────────── queries ─────────────────────────
  private anyRole(): CallerIdentityChecked { return this.requireRole([...ROLES]); }

  GetInvoice(invoiceId: string): Invoice { this.anyRole(); return this.invoice(invoiceId); }

  GetInvoicePrivateDetails(invoiceId: string): InvoicePrivateDetails {
    const c = this.anyRole();
    const inv = this.invoice(invoiceId);
    if (!PRIVATE_COLLECTION_MSPS.has(c.mspId)) throw new LedgerError('ERR_UNAUTHORIZED_ROLE', `org ${c.mspId} is not a member of ${COLLECTION_INVOICE_DETAILS}`, { mspId: c.mspId, collection: COLLECTION_INVOICE_DETAILS });
    const allowed = c.role === 'OPERATOR' || c.participantId === inv.supplierId || c.participantId === inv.buyerId;
    if (!allowed) throw new LedgerError('ERR_UNAUTHORIZED_ROLE', `participant ${c.participantId} is neither supplier, buyer nor operator for this invoice`, { invoiceId, participantId: c.participantId });
    const raw = this.stub.getPrivateData(COLLECTION_INVOICE_DETAILS, KEYS.invoice(invoiceId));
    if (!raw) throw new LedgerError('ERR_NOT_FOUND', `private details for ${invoiceId} not found`, { invoiceId });
    return JSON.parse(raw) as InvoicePrivateDetails;
  }

  private invoicePageFromIndex(prefix: string, pageSize: string, bookmark: string): Page<Invoice> {
    this.anyRole();
    const size = parseInt64(pageSize, 'pageSize', { min: 1, max: 1000 });
    const ids = this.stub.getStateByPrefix(prefix).map((kv) => kv.value);
    const page = this.paginate(ids, size, bookmark, (id) => id);
    return { items: page.items.map((id) => this.invoice(id)), nextBookmark: page.nextBookmark };
  }
  ListInvoicesByStatus(status: string, pageSize: string, bookmark: string): Page<Invoice> {
    if (!(INVOICE_STATUSES as readonly string[]).includes(status)) throw new LedgerError('ERR_INVALID_ARGUMENT', `unknown status ${status}`, { field: 'status' });
    return this.invoicePageFromIndex(`STATUS~${status}~`, pageSize, bookmark);
  }
  ListInvoicesBySupplier(supplierId: string, pageSize: string, bookmark: string): Page<Invoice> { return this.invoicePageFromIndex(`SUP~${supplierId}~`, pageSize, bookmark); }
  ListInvoicesByBuyer(buyerId: string, pageSize: string, bookmark: string): Page<Invoice> { return this.invoicePageFromIndex(`BUY~${buyerId}~`, pageSize, bookmark); }
  ListAllInvoices(pageSize: string, bookmark: string): Page<Invoice> {
    this.anyRole();
    const size = parseInt64(pageSize, 'pageSize', { min: 1, max: 1000 });
    const all = this.list<Invoice>('INV~');
    return this.paginate(all, size, bookmark, (i) => i.invoiceId);
  }
  GetHoldingsByInvoice(invoiceId: string): Holding[] { this.anyRole(); return this.list<Holding>(`HOLD~${invoiceId}~`); }
  GetHoldingsByInvestor(investorId: string): Holding[] {
    this.anyRole();
    return this.stub.getStateByPrefix(`HOLDINV~${investorId}~`).map((kv) => this.get<Holding>(KEYS.holding(kv.value, investorId))).filter((h): h is Holding => !!h);
  }
  GetInvoiceHistory(invoiceId: string): HistoryEntry[] {
    this.anyRole();
    this.invoice(invoiceId);
    return this.stub.getHistoryForKey(KEYS.invoice(invoiceId)).map((h) => ({
      txId: h.txId, timestamp: h.timestamp, isDelete: h.isDelete, blockNumber: h.blockNumber, fn: h.fn, actorId: h.actorId,
      value: h.value ? (JSON.parse(h.value) as Invoice) : null,
    }));
  }
  GetBuyerScore(buyerId: string): BuyerScore { this.anyRole(); const s = this.scoreFor(buyerId); if (!s.lastUpdated) s.lastUpdated = this.now(); return s; }
  GetParticipant(participantId: string): Participant { this.anyRole(); return this.participant(participantId); }
  ListParticipants(pageSize: string, bookmark: string): Page<Participant> {
    this.anyRole();
    const size = parseInt64(pageSize, 'pageSize', { min: 1, max: 1000 });
    return this.paginate(this.list<Participant>('PART~'), size, bookmark, (p) => p.id);
  }
  GetPlatformStats(): PlatformStats {
    this.anyRole();
    const invoices = this.list<Invoice>('INV~');
    const holdings = this.list<Holding>('HOLD~');
    const active = new Set<InvoiceStatus>(['LISTED', 'PARTIALLY_FUNDED', 'FULLY_FUNDED', 'SUPPLIER_PAID', 'LATE']);
    const listed = invoices.filter((i) => i.annualizedYieldBps > 0);
    const settled = invoices.filter((i) => i.status === 'SETTLED').length;
    const defaulted = invoices.filter((i) => i.status === 'DEFAULTED').length;
    return {
      totalInvoices: invoices.length,
      activeInvoices: invoices.filter((i) => active.has(i.status)).length,
      settledInvoices: settled,
      totalFundedPaise: holdings.reduce((s, h) => s + h.costPaise, 0),
      totalFaceValuePaise: invoices.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + i.faceValuePaise, 0),
      activeInvestors: new Set(holdings.map((h) => h.holderId)).size,
      avgYieldBps: listed.length ? Math.trunc(listed.reduce((s, i) => s + i.annualizedYieldBps, 0) / listed.length) : 0,
      defaultRateBps: settled + defaulted > 0 ? mulDivFloor(defaulted, 10000, settled + defaulted) : 0,
      blockHeight: this.stub.getBlockNumber(),
    };
  }
  GetAnomalies(pageSize: string, bookmark: string): Page<AnomalyRecord> {
    this.anyRole();
    const size = parseInt64(pageSize, 'pageSize', { min: 1, max: 1000 });
    const all = this.list<AnomalyRecord>('ANOM~').sort((a, b) => cmp(b.recordedAt, a.recordedAt) || cmp(a.anomalyId, b.anomalyId));
    return this.paginate(all, size, bookmark, (a) => a.anomalyId);
  }
  GetAuditTrail(startTime: string, endTime: string, pageSize: string, bookmark: string): Page<AuditEntry> {
    this.anyRole();
    const size = parseInt64(pageSize, 'pageSize', { min: 1, max: 1000 });
    const all = this.list<AuditEntry>('AUDIT~').filter((e) => (!startTime || e.timestamp >= startTime) && (!endTime || e.timestamp <= endTime));
    return this.paginate(all, size, bookmark, (e) => `${e.timestamp}~${e.txId}`);
  }
  GetPaymentsByInvoice(invoiceId: string): PaymentRecord[] {
    this.anyRole();
    return this.stub.getStateByPrefix(`PAYINV~${invoiceId}~`).map((kv) => this.get<PaymentRecord>(KEYS.payment(kv.value))).filter((p): p is PaymentRecord => !!p);
  }
  ListPayments(pageSize: string, bookmark: string): Page<PaymentRecord> {
    this.anyRole();
    const size = parseInt64(pageSize, 'pageSize', { min: 1, max: 1000 });
    return this.paginate(this.list<PaymentRecord>('PAY~'), size, bookmark, (p) => p.upiRef);
  }
  GetClock(): Clock { this.anyRole(); return { now: this.now(), offsetSeconds: Number(this.stub.getState(KEYS.clock) ?? '0'), demoMode: this.config().demoMode }; }
  GetConfig(): LedgerConfig { this.anyRole(); return this.config(); }
}

type CallerIdentityChecked = { mspId: string; role: Role; participantId: string };

export const MUTATING_FUNCTIONS = new Set([
  'InitLedger', 'RegisterParticipant', 'SetKycStatus', 'FreezeParticipant', 'UnfreezeParticipant', 'CreateInvoice', 'BuyerAcceptInvoice',
  'ListInvoice', 'CancelInvoice', 'Invest', 'ReleaseToSupplier', 'RecordRepayment', 'MarkLate', 'MarkDefault', 'RecordAnomaly',
  'AdvanceDemoClock', 'SeedBuyerHistory',
]);
export const QUERY_FUNCTIONS = new Set([
  'GetInvoice', 'GetInvoicePrivateDetails', 'ListInvoicesByStatus', 'ListInvoicesBySupplier', 'ListInvoicesByBuyer', 'ListAllInvoices',
  'GetHoldingsByInvoice', 'GetHoldingsByInvestor', 'GetInvoiceHistory', 'GetBuyerScore', 'GetParticipant', 'ListParticipants',
  'GetPlatformStats', 'GetAnomalies', 'GetAuditTrail', 'GetPaymentsByInvoice', 'ListPayments', 'GetClock', 'GetConfig',
]);

/** Dispatch a function by name with string args (same calling convention as Fabric). */
export function invokeContract(contract: BillBridgeContract, fn: string, args: string[]): unknown {
  if (!MUTATING_FUNCTIONS.has(fn) && !QUERY_FUNCTIONS.has(fn)) throw new LedgerError('ERR_INVALID_ARGUMENT', `unknown function ${fn}`, { fn });
  const method = (contract as unknown as Record<string, (...a: string[]) => unknown>)[fn];
  if (typeof method !== 'function') throw new LedgerError('ERR_INVALID_ARGUMENT', `unknown function ${fn}`, { fn });
  return method.apply(contract, args);
}
