'use client';
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import type { Role } from '@billbridge/shared';
import { api, type ListInvoicesParams } from './api';

export const qk = {
  stats: ['stats'] as const,
  network: ['network'] as const,
  demoState: ['demoState'] as const,
  invoices: (params: ListInvoicesParams) => ['invoices', params] as const,
  invoice: (id: string) => ['invoice', id] as const,
  history: (id: string) => ['invoice', id, 'history'] as const,
  portfolio: ['portfolio'] as const,
  anomalies: ['anomalies'] as const,
  participants: ['participants'] as const,
  reconciliation: ['reconciliation'] as const,
  scores: (buyerId: string) => ['scores', buyerId] as const,
  audit: (params: Record<string, string | number | undefined>) => ['audit', params] as const,
  upi: (params: Record<string, string | undefined>) => ['upi', params] as const,
  health: ['health'] as const,
};

export const useStats = (refetchInterval = 5000) => useQuery({ queryKey: qk.stats, queryFn: api.stats, refetchInterval });
export const useNetwork = () => useQuery({ queryKey: qk.network, queryFn: api.network, refetchInterval: 10_000 });
export const useDemoState = () => useQuery({ queryKey: qk.demoState, queryFn: api.demoState, refetchInterval: 8000 });
export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.health, retry: false, refetchInterval: 15_000 });
export const useInvoices = (params: ListInvoicesParams = {}, enabled = true) =>
  useQuery({ queryKey: qk.invoices(params), queryFn: () => api.listInvoices(params), enabled });
export const useInvoice = (id: string | null) =>
  useQuery({ queryKey: qk.invoice(id ?? ''), queryFn: () => api.invoice(id ?? ''), enabled: !!id });
export const useInvoiceHistory = (id: string | null) =>
  useQuery({ queryKey: qk.history(id ?? ''), queryFn: () => api.invoiceHistory(id ?? ''), enabled: !!id });
export const usePortfolio = () => useQuery({ queryKey: qk.portfolio, queryFn: api.portfolio });
export const useAnomalies = () => useQuery({ queryKey: qk.anomalies, queryFn: api.anomalies });
export const useParticipants = () => useQuery({ queryKey: qk.participants, queryFn: api.participants });
export const useReconciliation = () => useQuery({ queryKey: qk.reconciliation, queryFn: api.reconciliation });
export const useScores = (buyerId: string | null) =>
  useQuery({ queryKey: qk.scores(buyerId ?? ''), queryFn: () => api.scores(buyerId ?? ''), enabled: !!buyerId });
export const useAuditEvents = (params: { invoiceId?: string; participantId?: string; pageSize?: number } = {}) =>
  useQuery({ queryKey: qk.audit(params), queryFn: () => api.auditEvents(params) });
export const useUpiTransactions = (params: { invoiceId?: string; status?: string } = {}) =>
  useQuery({ queryKey: qk.upi(params), queryFn: () => api.upiTransactions(params) });

/** Invalidate everything that a ledger transaction may have changed. */
export function useInvalidateLedger() {
  const qc = useQueryClient();
  return (invoiceId?: string) => {
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: qk.stats });
    void qc.invalidateQueries({ queryKey: qk.network });
    void qc.invalidateQueries({ queryKey: qk.demoState });
    void qc.invalidateQueries({ queryKey: qk.portfolio });
    void qc.invalidateQueries({ queryKey: qk.anomalies });
    void qc.invalidateQueries({ queryKey: qk.participants });
    void qc.invalidateQueries({ queryKey: ['scores'] });
    void qc.invalidateQueries({ queryKey: ['audit'] });
    void qc.invalidateQueries({ queryKey: ['upi'] });
    if (invoiceId) void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    else void qc.invalidateQueries({ queryKey: ['invoice'] });
  };
}

type Opts<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>;

function useLedgerMutation<TData, TVars>(fn: (v: TVars) => Promise<TData>, pick: (v: TVars) => string | undefined, opts?: Opts<TData, TVars>) {
  const invalidate = useInvalidateLedger();
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    ...opts,
    onSettled: (data, err, vars, ctx, mutation) => {
      invalidate(pick(vars));
      opts?.onSettled?.(data, err, vars, ctx, mutation);
    },
  });
}

export const useUpload = () => useMutation({ mutationFn: (file: File) => api.upload(file) });
export const useCreateInvoice = (opts?: Opts<Awaited<ReturnType<typeof api.createInvoice>>, Parameters<typeof api.createInvoice>[0]>) =>
  useLedgerMutation(api.createInvoice, () => undefined, opts);
export const useAcceptInvoice = () => useLedgerMutation((id: string) => api.acceptInvoice(id), (id) => id);
export const useListInvoice = () =>
  useLedgerMutation((v: { id: string; discountBps: number; minFundingUnits: number }) => api.listInvoice(v.id, v), (v) => v.id);
export const useCancelInvoice = () => useLedgerMutation((v: { id: string; reason: string }) => api.cancelInvoice(v.id, { reason: v.reason }), (v) => v.id);
export const useInvestIntent = () => useMutation({ mutationFn: (v: { invoiceId: string; units: number }) => api.investIntent(v.invoiceId, v.units) });
export const useRepaymentIntent = () => useMutation({ mutationFn: (invoiceId: string) => api.repaymentIntent(invoiceId) });
export const useSupplierPayout = () => useLedgerMutation((id: string) => api.supplierPayout(id), (id) => id);
export const useMarkLate = () => useLedgerMutation((id: string) => api.markLate(id), (id) => id);
export const useMarkDefault = () => useLedgerMutation((id: string) => api.markDefault(id), (id) => id);
export const useKyc = () => useLedgerMutation((v: { participantId: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; kycDocHash?: string }) => api.kyc(v.participantId, v), () => undefined);
export const useFreeze = () => useLedgerMutation((v: { participantId: string; frozen: boolean; reason?: string }) => api.freeze(v.participantId, v), () => undefined);
export const useSeed = () => useLedgerMutation(() => api.seed(), () => undefined);
export const useReset = () => useLedgerMutation(() => api.reset(), () => undefined);
export const useTimeTravel = () => useLedgerMutation((v: Parameters<typeof api.timeTravel>[0]) => api.timeTravel(v), () => undefined);
export const useSimulatePayment = () => useLedgerMutation((v: { upiRef: string; fail?: boolean }) => api.simulatePayment(v), () => undefined);
export const useAttack = () => useLedgerMutation((variant: 'SAME_FILE' | 'NEW_NUMBER' | 'CHANGED_AMOUNT') => api.attack({ variant }), () => undefined);
export const useInjectMismatch = () => useLedgerMutation(() => api.injectMismatch(), () => undefined);
export type { Role };
