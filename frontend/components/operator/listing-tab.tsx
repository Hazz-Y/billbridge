'use client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { computePricing, daysBetween, formatBps, type InvoiceSummary } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Field } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { InvoiceCard } from '@/components/bb/invoice-card';
import { MoneyText } from '@/components/bb/money-text';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { toastTx } from '@/components/bb/tx-badge';
import { useInvoices, useListInvoice, useStats } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDate, todayIso } from '@/lib/utils';

function ListingForm({ inv, simulatedNow, onDone }: { inv: InvoiceSummary; simulatedNow: string; onDone: () => void }) {
  const [bps, setBps] = useState(800);
  const [minUnits, setMinUnits] = useState(Math.max(1, Math.ceil(inv.totalUnits / 10)));
  const [server, setServer] = useState<{ pricePerUnitPaise: number; annualizedYieldBps: number; tenorDays: number } | null>(null);
  const list = useListInvoice();
  const tenorDays = Math.max(1, daysBetween(simulatedNow.slice(0, 10) || todayIso(), inv.dueDate));
  const local = useMemo(() => {
    try { return computePricing(inv.unitFaceValuePaise, bps, tenorDays); } catch { return null; }
  }, [inv.unitFaceValuePaise, bps, tenorDays]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.pricingPreview(inv.invoiceId, bps, minUnits).then((p) => { if (live) setServer(p); }).catch(() => { if (live) setServer(null); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [inv.invoiceId, bps, minUnits]);

  const submit = () => list.mutateAsync({ id: inv.invoiceId, discountBps: bps, minFundingUnits: minUnits })
    .then((r) => { toastTx('Invoice listed', r.tx, `${formatBps(r.invoice.discountBps)} discount · ${formatBps(r.invoice.annualizedYieldBps)} yield`); onDone(); })
    .catch((e) => toast.error('Listing failed', { description: errorMessage(e) }));

  return (
    <Card className="border-primary/40">
      <CardHeader><CardTitle>Price listing · {inv.supplierName} → {inv.buyerName}</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Label htmlFor="bps">Annualized discount (bps) — 100 to 3000</Label>
            <div className="flex items-center gap-3">
              <input id="bps-range" type="range" min={100} max={3000} step={25} value={bps} onChange={(e) => setBps(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" aria-label="Discount slider" />
              <Input id="bps" mono type="number" min={100} max={3000} value={bps} onChange={(e) => setBps(Math.trunc(Number(e.target.value) || 0))} className="w-24" />
            </div>
            <div className="mono mt-1 text-xs text-muted">= {formatBps(bps)} per year, prorated over {tenorDays} days</div>
          </div>
          <div>
            <Label htmlFor="minUnits">Minimum funding units (of {inv.totalUnits})</Label>
            <Input id="minUnits" mono type="number" min={1} max={inv.totalUnits} value={minUnits} onChange={(e) => setMinUnits(Math.max(1, Math.min(inv.totalUnits, Math.trunc(Number(e.target.value) || 1))))} />
          </div>
          <Button size="lg" className="w-full" loading={list.isPending} disabled={!local || bps < 100 || bps > 3000} onClick={submit}>List on marketplace</Button>
        </div>
        <div className="glass grid grid-cols-2 gap-3 rounded-xl p-4">
          <Field label="Tenor">{tenorDays} days (to {formatDate(inv.dueDate)})</Field>
          <Field label="Unit face"><MoneyText paise={inv.unitFaceValuePaise} /></Field>
          <Field label="Discount / unit"><MoneyText paise={local?.discountPerUnitPaise ?? 0} /></Field>
          <Field label="Price / unit"><MoneyText paise={local?.pricePerUnitPaise ?? 0} /></Field>
          <Field label="Investor yield p.a."><span className="mono text-success">{local ? formatBps(local.annualizedYieldBps) : '—'}</span></Field>
          <Field label="Supplier receives (full)"><MoneyText paise={(local?.pricePerUnitPaise ?? 0) * inv.totalUnits} /></Field>
          <div className="col-span-2 text-[11px] text-muted">
            {server ? (server.pricePerUnitPaise === local?.pricePerUnitPaise ? '✓ Server preview agrees with local integer math.' : `Server preview differs: price ${server.pricePerUnitPaise}, yield ${formatBps(server.annualizedYieldBps)}, tenor ${server.tenorDays}d (server clock wins).`) : 'Local preview (server preview unavailable).'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ListingTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useInvoices({ status: 'BUYER_ACCEPTED', pageSize: 100 });
  const stats = useStats(10_000);
  const [sel, setSel] = useState<InvoiceSummary | null>(null);
  const now = stats.data?.simulatedNow ?? new Date().toISOString();
  return (
    <div className="space-y-4">
      {sel && <ListingForm inv={sel} simulatedNow={now} onDone={() => setSel(null)} />}
      <DataState query={q} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="Nothing awaiting listing" description="Buyer-accepted invoices appear here for pricing." />} skeleton={<div className="grid gap-3 md:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>}>
        {(d) => (
          <div className="grid gap-3 md:grid-cols-2">
            {d.items.map((inv) => (
              <InvoiceCard key={inv.invoiceId} inv={inv} perspective="operator" onOpen={onOpen} actions={<Button size="sm" variant={sel?.invoiceId === inv.invoiceId ? 'primary' : 'outline'} onClick={() => setSel(inv)}>Price & list</Button>} />
            ))}
          </div>
        )}
      </DataState>
    </div>
  );
}
