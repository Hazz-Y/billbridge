'use client';
import { AlertOctagon, Banknote, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_LEDGER_CONFIG, addDays, daysBetween, type InvoiceSummary } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { InvoiceCard } from '@/components/bb/invoice-card';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { toastTx } from '@/components/bb/tx-badge';
import { useInvoices, useMarkDefault, useMarkLate, useStats, useSupplierPayout } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const FUNDED: InvoiceSummary['status'][] = ['PARTIALLY_FUNDED', 'FULLY_FUNDED'];
const OUTSTANDING: InvoiceSummary['status'][] = ['SUPPLIER_PAID', 'LATE'];

function Windows({ inv, today }: { inv: InvoiceSummary; today: string }) {
  const grace = addDays(inv.dueDate, DEFAULT_LEDGER_CONFIG.graceDays);
  const dflt = addDays(inv.dueDate, DEFAULT_LEDGER_CONFIG.defaultDays);
  const sinceDue = daysBetween(inv.dueDate, today);
  return (
    <div className="mono flex flex-wrap gap-2 text-[11px]">
      <Badge tone={sinceDue >= 0 ? 'warning' : 'muted'}>due {formatDate(inv.dueDate)}</Badge>
      <Badge tone={today >= grace ? 'warning' : 'muted'}>late after {formatDate(grace)} (+{DEFAULT_LEDGER_CONFIG.graceDays}d)</Badge>
      <Badge tone={today >= dflt ? 'danger' : 'muted'}>default after {formatDate(dflt)} (+{DEFAULT_LEDGER_CONFIG.defaultDays}d)</Badge>
      <span className="text-muted">{sinceDue >= 0 ? `${sinceDue}d past due` : `${-sinceDue}d to due`}</span>
    </div>
  );
}

export function SettlementTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useInvoices({ pageSize: 200 });
  const stats = useStats(5000);
  const payout = useSupplierPayout();
  const late = useMarkLate();
  const dflt = useMarkDefault();
  const today = (stats.data?.simulatedNow ?? new Date().toISOString()).slice(0, 10);
  const fail = (e: unknown) => toast.error('Settlement action failed', { description: errorMessage(e) });

  return (
    <div className="space-y-6">
      <div className="mono text-xs text-muted">Simulated date: {formatDate(today)} · grace {DEFAULT_LEDGER_CONFIG.graceDays} days · default {DEFAULT_LEDGER_CONFIG.defaultDays} days</div>
      <DataState query={q} skeleton={<div className="grid gap-3 md:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>}>
        {(d) => {
          const funded = d.items.filter((i) => FUNDED.includes(i.status));
          const outstanding = d.items.filter((i) => OUTSTANDING.includes(i.status));
          return (
            <>
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 font-semibold"><Banknote className="h-4 w-4 text-success" /> Supplier payouts ({funded.length})</h3>
                {funded.length === 0 ? <EmptyState title="No funded invoices awaiting payout" /> : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {funded.map((inv) => {
                      const belowMin = inv.unitsSold < inv.minFundingUnits;
                      return (
                        <InvoiceCard key={inv.invoiceId} inv={inv} perspective="operator" onOpen={onOpen} actions={
                          <Tooltip content={belowMin ? `Needs at least ${inv.minFundingUnits} units sold (${inv.unitsSold} so far)` : 'Release the funded amount to the supplier via UPI'} asChild={false}>
                            <span><Button size="sm" variant="success" disabled={belowMin} loading={payout.isPending && payout.variables === inv.invoiceId}
                              onClick={() => payout.mutateAsync(inv.invoiceId).then((r) => toastTx('Supplier paid', r.tx, `${r.upi.upiRef} · ${r.upi.status}`)).catch(fail)}>Pay supplier</Button></span>
                          </Tooltip>
                        } />
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-warning" /> Outstanding repayments ({outstanding.length})</h3>
                {outstanding.length === 0 ? <EmptyState title="No outstanding repayments" /> : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {outstanding.map((inv) => {
                      const canLate = inv.status === 'SUPPLIER_PAID' && today >= addDays(inv.dueDate, DEFAULT_LEDGER_CONFIG.graceDays);
                      const canDefault = today >= addDays(inv.dueDate, DEFAULT_LEDGER_CONFIG.defaultDays);
                      return (
                        <InvoiceCard key={inv.invoiceId} inv={inv} perspective="operator" onOpen={onOpen} showPipeline={false} actions={<>
                          <div className="w-full"><Windows inv={inv} today={today} /></div>
                          <Tooltip content={inv.status === 'LATE' ? 'Already marked late' : canLate ? 'Grace window elapsed' : 'Window opens after due date + grace days (use Time travel)'} asChild={false}>
                            <span><Button size="sm" variant="outline" disabled={!canLate} loading={late.isPending && late.variables === inv.invoiceId}
                              onClick={() => late.mutateAsync(inv.invoiceId).then((r) => toastTx('Marked late', r.tx)).catch(fail)}>Mark late</Button></span>
                          </Tooltip>
                          <Tooltip content={canDefault ? 'Default window open: investors take a pro-rata loss and the buyer score drops' : 'Window opens after due date + 90 days (use Time travel)'} asChild={false}>
                            <span><Button size="sm" variant="danger" disabled={!canDefault} loading={dflt.isPending && dflt.variables === inv.invoiceId}
                              onClick={() => dflt.mutateAsync(inv.invoiceId).then((r) => toastTx('Marked default', r.tx, `Buyer score now ${r.buyerScore.score}`)).catch(fail)}><AlertOctagon className="h-4 w-4" /> Mark default</Button></span>
                          </Tooltip>
                        </>} />
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          );
        }}
      </DataState>
    </div>
  );
}
