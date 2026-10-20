'use client';
import { z } from 'zod';
import {
  AnomalyListResponseSchema, ApiErrorSchema, AttackRequestSchema, AttackResponseSchema, AuditEventsResponseSchema,
  CancelInvoiceRequestSchema, CreateInvoiceRequestSchema, DemoStateResponseSchema, FreezeRequestSchema,
  InvoiceDetailSchema, InvoiceHistoryResponseSchema, InvoiceListResponseSchema, InvoiceWithMetaSchema,
  InvestIntentRequestSchema, KycRequestSchema, ListInvoiceRequestSchema, LoginRequestSchema, NetworkResponseSchema,
  ParticipantListResponseSchema, ParticipantWithUserSchema, PaymentIntentResponseSchema, PortfolioResponseSchema,
  PricingPreviewSchema, ReconciliationResponseSchema, RegisterRequestSchema, ScoreResponseSchema, SeedResponseSchema,
  SimulatePaymentRequestSchema, StatsResponseSchema, SupplierPayoutResponseSchema, SwitchRoleRequestSchema,
  TimeTravelRequestSchema, TimeTravelResponseSchema, TokenResponseSchema, UpiTransactionSchema, UploadResponseSchema,
  UserProfileSchema, WebhookResultSchema, BuyerScoreSchema, HoldingSchema, InvoiceSchema, TxMetaSchema,
  type ErrorCode, type InvoiceStatus,
} from '@billbridge/shared';
import { accessToken, readAuth, writeAuth } from './auth-store';
import { isMockMode } from './utils';
import { mockRequest } from './mock/handler';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiClientError extends Error {
  readonly code: ErrorCode | 'ERR_NETWORK';
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode | 'ERR_NETWORK', message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const auth = readAuth();
    if (!auth) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });
      if (!res.ok) { writeAuth(null); return false; }
      writeAuth(TokenResponseSchema.parse(await res.json()));
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function toError(res: Response): Promise<ApiClientError> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiClientError(code, message, res.status, details ?? {});
  }
  return new ApiClientError(res.status === 401 ? 'ERR_AUTH' : 'ERR_INTERNAL', `HTTP ${res.status} ${res.statusText}`, res.status);
}

export async function request<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, opts: RequestOptions = {}, retried = false): Promise<T> {
  if (isMockMode()) {
    try {
      const data = await mockRequest(opts.method ?? 'GET', buildUrl(path, opts.query), opts.body ?? opts.form ?? null);
      return schema.parse(data);
    } catch (e) {
      if (e instanceof Error && 'mock' in e) {
        const m = e as unknown as Error & { code: ErrorCode; status: number; details: Record<string, unknown> };
        throw new ApiClientError(m.code, m.message, m.status, m.details);
      }
      throw e;
    }
  }
  const headers: Record<string, string> = {};
  const token = accessToken();
  if (opts.auth !== false && token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET', headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch (e) {
    throw new ApiClientError('ERR_NETWORK', `Cannot reach API at ${API_BASE} (${e instanceof Error ? e.message : 'network error'})`, 0);
  }
  if (res.status === 401 && !retried && opts.auth !== false && token) {
    if (await tryRefresh()) return request(path, schema, opts, true);
  }
  if (!res.ok) throw await toError(res);
  const json: unknown = await res.json();
  return schema.parse(json);
}

const UpiListSchema = z.object({ items: z.array(UpiTransactionSchema) });
const MarkDefaultSchema = z.object({ invoice: InvoiceSchema, buyerScore: BuyerScoreSchema, holdings: z.array(HoldingSchema), tx: TxMetaSchema });
const InjectMismatchSchema = z.object({ upiRef: z.string(), reason: z.string() });
export const HealthSchema = z.object({ ok: z.boolean(), simulatedNow: z.string().optional(), demoMode: z.boolean().optional() }).passthrough();

export interface ListInvoicesParams {
  status?: InvoiceStatus; supplierId?: string; buyerId?: string; marketplace?: boolean; pageSize?: number; bookmark?: string;
}

export const api = {
  // auth
  register: (body: z.input<typeof RegisterRequestSchema>) =>
    request('/api/auth/register', TokenResponseSchema, { method: 'POST', body: RegisterRequestSchema.parse(body), auth: false }),
  login: (body: z.input<typeof LoginRequestSchema>) =>
    request('/api/auth/login', TokenResponseSchema, { method: 'POST', body: LoginRequestSchema.parse(body), auth: false }),
  me: () => request('/api/auth/me', UserProfileSchema),
  health: () => request('/health', HealthSchema, { auth: false }),
  // invoices
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request('/api/invoices/upload', UploadResponseSchema, { method: 'POST', form });
  },
  createInvoice: (body: z.input<typeof CreateInvoiceRequestSchema>) =>
    request('/api/invoices', InvoiceWithMetaSchema, { method: 'POST', body: CreateInvoiceRequestSchema.parse(body) }),
  listInvoices: (params: ListInvoicesParams = {}) =>
    request('/api/invoices', InvoiceListResponseSchema, { query: { ...params } }),
  invoice: (id: string) => request(`/api/invoices/${id}`, InvoiceDetailSchema),
  invoiceHistory: (id: string) => request(`/api/invoices/${id}/history`, InvoiceHistoryResponseSchema),
  acceptInvoice: (id: string) => request(`/api/invoices/${id}/accept`, InvoiceWithMetaSchema, { method: 'POST' }),
  listInvoice: (id: string, body: z.input<typeof ListInvoiceRequestSchema>) =>
    request(`/api/invoices/${id}/list`, InvoiceWithMetaSchema, { method: 'POST', body: ListInvoiceRequestSchema.parse(body) }),
  cancelInvoice: (id: string, body: z.input<typeof CancelInvoiceRequestSchema>) =>
    request(`/api/invoices/${id}/cancel`, InvoiceWithMetaSchema, { method: 'POST', body: CancelInvoiceRequestSchema.parse(body) }),
  pricingPreview: (id: string, discountBps: number, minFundingUnits: number) =>
    request(`/api/invoices/${id}/pricing-preview`, PricingPreviewSchema, { query: { discountBps, minFundingUnits } }),
  // invest
  investIntent: (invoiceId: string, units: number) =>
    request(`/api/invest/${invoiceId}/intent`, PaymentIntentResponseSchema, { method: 'POST', body: InvestIntentRequestSchema.parse({ units }) }),
  portfolio: () => request('/api/invest/portfolio', PortfolioResponseSchema),
  upiTransaction: (upiRef: string) => request(`/api/invest/upi/${upiRef}`, UpiTransactionSchema),
  upiTransactions: (params: { invoiceId?: string; status?: string } = {}) =>
    request('/api/invest/upi', UpiListSchema, { query: params }),
  // settlement
  supplierPayout: (invoiceId: string) =>
    request(`/api/settlement/${invoiceId}/supplier-payout`, SupplierPayoutResponseSchema, { method: 'POST' }),
  repaymentIntent: (invoiceId: string) =>
    request(`/api/settlement/${invoiceId}/repayment-intent`, PaymentIntentResponseSchema, { method: 'POST' }),
  markLate: (invoiceId: string) => request(`/api/settlement/${invoiceId}/mark-late`, InvoiceWithMetaSchema, { method: 'POST' }),
  markDefault: (invoiceId: string) => request(`/api/settlement/${invoiceId}/mark-default`, MarkDefaultSchema, { method: 'POST' }),
  // platform
  stats: () => request('/api/platform/stats', StatsResponseSchema, { auth: false }),
  scores: (buyerId: string) => request(`/api/platform/scores/${buyerId}`, ScoreResponseSchema),
  reconciliation: () => request('/api/platform/reconciliation', ReconciliationResponseSchema),
  auditEvents: (params: { invoiceId?: string; participantId?: string; type?: string; pageSize?: number } = {}) =>
    request('/api/platform/audit/events', AuditEventsResponseSchema, { query: params }),
  anomalies: () => request('/api/platform/anomalies', AnomalyListResponseSchema, { query: { pageSize: 100 } }),
  participants: () => request('/api/platform/participants', ParticipantListResponseSchema),
  kyc: (participantId: string, body: z.input<typeof KycRequestSchema>) =>
    request(`/api/platform/kyc/${participantId}`, ParticipantWithUserSchema, { method: 'POST', body: KycRequestSchema.parse(body) }),
  freeze: (participantId: string, body: z.input<typeof FreezeRequestSchema>) =>
    request(`/api/platform/freeze/${participantId}`, ParticipantWithUserSchema, { method: 'POST', body: FreezeRequestSchema.parse(body) }),
  network: () => request('/api/platform/network', NetworkResponseSchema, { auth: false }),
  // demo
  demoState: () => request('/api/demo/state', DemoStateResponseSchema, { auth: false }),
  seed: () => request('/api/demo/seed', SeedResponseSchema, { method: 'POST' }),
  reset: () => request('/api/demo/reset', SeedResponseSchema, { method: 'POST' }),
  timeTravel: (body: z.input<typeof TimeTravelRequestSchema>) =>
    request('/api/demo/time-travel', TimeTravelResponseSchema, { method: 'POST', body: TimeTravelRequestSchema.parse(body) }),
  simulatePayment: (body: z.input<typeof SimulatePaymentRequestSchema>) =>
    request('/api/demo/simulate-payment', WebhookResultSchema, { method: 'POST', body: SimulatePaymentRequestSchema.parse(body) }),
  attack: (body: z.input<typeof AttackRequestSchema>) =>
    request('/api/demo/attack/duplicate', AttackResponseSchema, { method: 'POST', body: AttackRequestSchema.parse(body) }),
  injectMismatch: () => request('/api/demo/inject-mismatch', InjectMismatchSchema, { method: 'POST' }),
  switchRole: (body: z.input<typeof SwitchRoleRequestSchema>) =>
    request('/api/demo/switch-role', TokenResponseSchema, { method: 'POST', body: SwitchRoleRequestSchema.parse(body) }),
};

export type Api = typeof api;

export function auditCsvUrl(): string {
  const token = accessToken();
  return buildUrl('/api/platform/audit/events', { format: 'csv', pageSize: 200, ...(token ? { token } : {}) });
}

export function sseUrl(lastEventId: string | null): string {
  const token = accessToken();
  return buildUrl('/api/platform/audit/stream', { token: token ?? undefined, lastEventId: lastEventId ?? undefined });
}
