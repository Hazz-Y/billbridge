'use client';
import { Lock, Timer } from 'lucide-react';
import { computePricing, daysBetween, formatBps, type InvoiceDetail } from '@billbridge/shared';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/card';
import { PipelineTracker, ScoreBadge, UnitsProgress } from './indicators';
import { MoneyText } from './money-text';
import { StatusPill, statusLabel } from './status-pill';
import { TxBadge } from './tx-badge';
import { CardSkeleton, DataState, EmptyState } from './states';
import { useInvoice, useInvoiceHistory } from '@/lib/queries';
import { formatDate, formatDateTime, formatElapsed, shortId } from '@/lib/utils';

export function HistoryTimeline({ invoiceId }: { invoiceId: string }) {
  const q = useInvoiceHistory(invoiceId);
  return (
    <DataState query={q} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="No history yet" />} skeleton={<CardSkeleton rows={4} />}>
      {(d) => (
        <ol className="relative ml-2 border-l border-border pl-4">
          {d.items.map((h, i) => {
            const prev = d.items[i - 1]?.value?.status;
            const cur = h.value?.status;
            return (
              <li key={h.txId} className="relative pb-4">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{h.fn ?? (h.isDelete ? 'Delete' : 'Update')}</span>
                  {h.actorId && <span className="mono text-xs text-muted">by {h.actorId}</span>}
                  {cur && (prev !== cur ? <span className="text-xs text-muted">{prev ? `${statusLabel(prev)} → ` : ''}<StatusPill status={cur} /></span> : null)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="mono">{formatDateTime(h.timestamp)}</span>
                  <TxBadge txId={h.txId} blockNumber={h.blockNumber} size="xs" />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </DataState>
  );
}

function PayoutCard({ d }: { d: InvoiceDetail }) {
  const inv = d.invoice;
  if (!inv.supplierPaidAt || d.supplierPayoutElapsedSeconds === null) return null;
  const waitDays = inv.tenorDays || Math.max(1, daysBetween(inv.issueDate, inv.dueDate));
  const payout = d.payments.find((p) => p.kind === 'SUPPLIER_PAYOUT');
  return (
    <div className="rounded-2xl border border-success/40 bg-success/10 p-4">
      <div className="flex items-center gap-2 text-success"><Timer className="h-4 w-4" /><span className="font-semibold">Paid in {formatElapsed(d.supplierPayoutElapsedSeconds)}</span></div>
      <p className="mt-1 text-sm text-muted">vs a {waitDays}-day wait for the buyer to pay on {formatDate(inv.dueDate)}.</p>
      {payout && <div className="mt-2 flex items-center gap-2 text-sm"><MoneyText paise={payout.amountPaise} className="font-semibold" /> <span className="text-muted">to {payout.toId}</span> <TxBadge txId={payout.txId} size="xs" /></div>}
    </div>
  );
}

function CostCalculator({ d }: { d: InvoiceDetail }) {
  const inv = d.invoice;
  if (!inv.discountBps || !inv.tenorDays) return null;
  const p = computePricing(inv.unitFaceValuePaise, inv.discountBps, inv.tenorDays);
  const discountTotal = p.discountPerUnitPaise * inv.totalUnits;
  const net = inv.faceValuePaise - discountTotal;
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-2 text-sm font-semibold">Financing cost</div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Discount cost"><MoneyText paise={discountTotal} /></Field>
        <Field label="Effective annualized cost">{formatBps(inv.discountBps)}</Field>
        <Field label="Net cash if fully funded"><MoneyText paise={net} /></Field>
        <Field label="Tenor">{inv.tenorDays} days</Field>
      </div>
    </div>
  );
}

export function InvoiceDetailBody({ invoiceId, extra }: { invoiceId: string; extra?: (d: InvoiceDetail) => React.ReactNode }) {
  const q = useInvoice(invoiceId);
  return (
    <DataState query={q} skeleton={<CardSkeleton rows={6} />}>
      {(d) => {
        const inv = d.invoice;
        return (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusPill status={inv.status} />
              <TxBadge txId={inv.createdTxId} />
            </div>
            <PipelineTracker status={inv.status} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Face value"><MoneyText paise={inv.faceValuePaise} /></Field>
              <Field label="Due"><span className="mono">{formatDate(inv.dueDate)}</span></Field>
              <Field label="Supplier">{inv.supplierName}</Field>
              <Field label="Buyer">{inv.buyerName} <ScoreBadge score={inv.buyerScore} /></Field>
              {inv.discountBps > 0 && <Field label="Discount / yield">{formatBps(inv.discountBps)} · {formatBps(inv.annualizedYieldBps)} p.a.</Field>}
              {inv.pricePerUnitPaise > 0 && <Field label="Price per unit"><MoneyText paise={inv.pricePerUnitPaise} /></Field>}
            </div>
            {inv.discountBps > 0 && <UnitsProgress total={inv.totalUnits} sold={inv.unitsSold} reserved={inv.reservedUnits} />}
            <PayoutCard d={d} />
            {extra?.(d)}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Private details</h4>
              {d.privateDetails ? (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Invoice no." mono>{d.privateDetails.invoiceNumber}</Field>
                    <Field label="File hash" mono>{shortId(d.privateDetails.fileHash, 16)}</Field>
                    <Field label="Supplier GSTIN" mono>{d.privateDetails.supplierGstin}</Field>
                    <Field label="Buyer GSTIN" mono>{d.privateDetails.buyerGstin}</Field>
                  </div>
                  <ul className="divide-y divide-border rounded-xl border border-border text-xs">
                    {d.privateDetails.lineItems.map((li, i) => (
                      <li key={i} className="flex justify-between gap-2 px-3 py-2"><span>{li.description} <span className="text-muted">× {li.quantity}</span></span><MoneyText paise={li.totalPaise} /></li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-fg/5 p-3 text-sm text-muted">
                  <Lock className="h-4 w-4" />
                  {d.privateAccess === 'DENIED_ORG' ? 'Private details not shared with this org (private data collection).' : 'Private details are visible only to the supplier, buyer and operator.'}
                </div>
              )}
              <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] text-muted sm:grid-cols-2">
                <div><span className="uppercase tracking-wider">invoiceId</span> <span className="mono break-all">{inv.invoiceId}</span></div>
                <div><span className="uppercase tracking-wider">contentHash</span> <span className="mono break-all">{inv.contentHash}</span></div>
              </div>
            </section>
            <CostCalculator d={d} />
            {d.payments.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Payments</h4>
                <ul className="divide-y divide-border rounded-xl border border-border text-xs">
                  {d.payments.map((p) => (
                    <li key={p.upiRef} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span><Badge tone="neutral">{p.kind.replaceAll('_', ' ')}</Badge> <span className="mono text-muted">{p.fromId} → {p.toId}</span></span>
                      <span className="flex items-center gap-2"><MoneyText paise={p.amountPaise} /><TxBadge txId={p.txId} size="xs" /></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Ledger history</h4>
              <HistoryTimeline invoiceId={inv.invoiceId} />
            </section>
          </div>
        );
      }}
    </DataState>
  );
}

export function InvoiceDrawer({ invoiceId, onClose, extra }: { invoiceId: string | null; onClose: () => void; extra?: (d: InvoiceDetail) => React.ReactNode }) {
  return (
    <Dialog open={!!invoiceId} onOpenChange={(o) => { if (!o) onClose(); }}>
      {invoiceId && (
        <SheetContent title="Invoice" description={`id ${shortId(invoiceId, 16)}`}>
          <InvoiceDetailBody invoiceId={invoiceId} extra={extra} />
        </SheetContent>
      )}
    </Dialog>
  );
}
