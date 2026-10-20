'use client';
import { useMemo, useState } from 'react';
import { Lock, ShoppingBag, TrendingUp } from 'lucide-react';
import { formatBps, type InvoiceSummary } from '@billbridge/shared';
import { RequireRole, useAuth } from '@/lib/auth';
import { useInvoices, usePortfolio } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Field } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { InvoiceDrawer } from '@/components/bb/invoice-drawer';
import { ScoreBadge, UnitsProgress } from '@/components/bb/indicators';
import { MoneyText } from '@/components/bb/money-text';
import { StatusPill } from '@/components/bb/status-pill';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { InvestSheet } from '@/components/investor/invest-sheet';
import { formatDate, shortId } from '@/lib/utils';

type Sort = 'yield' | 'tenor' | 'score' | 'amount';

function MarketCard({ inv, canInvest, onInvest, onOpen }: { inv: InvoiceSummary; canInvest: boolean; onInvest: () => void; onOpen: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><div className="truncate font-medium">{inv.supplierName}</div><div className="truncate text-xs text-muted">buyer {inv.buyerName}</div></div>
          <ScoreBadge score={inv.buyerScore} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Face value"><MoneyText paise={inv.faceValuePaise} compact /></Field>
          <Field label="Discount">{formatBps(inv.discountBps)}</Field>
          <Field label="Tenor">{inv.tenorDays} d</Field>
          <Field label="Yield p.a."><span className="mono text-success">{formatBps(inv.annualizedYieldBps)}</span></Field>
          <Field label="Per unit"><MoneyText paise={inv.pricePerUnitPaise} /></Field>
          <Field label="Due"><span className="mono">{formatDate(inv.dueDate)}</span></Field>
        </div>
        <UnitsProgress total={inv.totalUnits} sold={inv.unitsSold} reserved={inv.reservedUnits} />
        <div className="mt-auto flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onOpen}>Details</Button>
          <Tooltip content={canInvest ? 'Create a UPI request for units' : 'KYC must be approved and your account unfrozen'} asChild={false}>
            <span className="flex-1"><Button size="sm" className="w-full" disabled={!canInvest || inv.availableUnits === 0} onClick={onInvest}><TrendingUp className="h-4 w-4" /> Invest</Button></span>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

function InvestorDashboard() {
  const { user } = useAuth();
  const market = useInvoices({ marketplace: true, pageSize: 100 });
  const portfolio = usePortfolio();
  const [sort, setSort] = useState<Sort>('yield');
  const [minScore, setMinScore] = useState(0);
  const [invest, setInvest] = useState<InvoiceSummary | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const canInvest = !!user && user.kycStatus === 'APPROVED' && !user.frozen;

  const items = useMemo(() => {
    const list = (market.data?.items ?? []).filter((i) => i.buyerScore >= minScore);
    const by: Record<Sort, (a: InvoiceSummary, b: InvoiceSummary) => number> = {
      yield: (a, b) => b.annualizedYieldBps - a.annualizedYieldBps, tenor: (a, b) => a.tenorDays - b.tenorDays,
      score: (a, b) => b.buyerScore - a.buyerScore, amount: (a, b) => b.faceValuePaise - a.faceValuePaise,
    };
    return [...list].sort(by[sort]);
  }, [market.data, sort, minScore]);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Marketplace</h1><p className="text-sm text-muted">Buy ₹1,000 units of buyer-accepted invoices. Yield accrues to maturity; repayment flows through the ledger waterfall.</p></div>
      {user && (user.kycStatus !== 'APPROVED' || user.frozen) && (
        <div className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm" role="alert">
          <Lock className="h-5 w-5 text-warning" />
          <div>
            <div className="font-medium">{user.frozen ? 'Your account is frozen' : `KYC ${user.kycStatus.toLowerCase()}`}</div>
            <div className="text-muted">{user.frozen ? (user.frozenReason ?? 'Contact the operator.') : 'An operator must approve your KYC before you can invest. Browsing is unrestricted.'}</div>
          </div>
        </div>
      )}
      <Tabs defaultValue="market">
        <TabsList>
          <TabsTrigger value="market"><ShoppingBag className="h-4 w-4" /> Marketplace</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
        </TabsList>
        <TabsContent value="market" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">Sort <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 w-40"><option value="yield">Highest yield</option><option value="tenor">Shortest tenor</option><option value="score">Best buyer score</option><option value="amount">Largest amount</option></Select></label>
            <label className="flex items-center gap-2">Min score <Select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="h-9 w-28"><option value={0}>Any</option><option value={50}>≥ 50</option><option value={75}>≥ 75</option></Select></label>
            {user && user.perInvoiceCapPaise > 0 && <span className="ml-auto text-xs text-muted">Per-invoice cap <MoneyText paise={user.perInvoiceCapPaise} compact /></span>}
          </div>
          <DataState query={market} isEmpty={() => items.length === 0} skeleton={<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <CardSkeleton key={i} rows={4} />)}</div>}
            empty={<EmptyState title="No listings right now" description="Listed invoices appear here as soon as the operator prices them." />}>
            {() => (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((inv) => <MarketCard key={inv.invoiceId} inv={inv} canInvest={canInvest} onInvest={() => setInvest(inv)} onOpen={() => setOpen(inv.invoiceId)} />)}
              </div>
            )}
          </DataState>
        </TabsContent>
        <TabsContent value="portfolio">
          <DataState query={portfolio} isEmpty={(d) => d.positions.length === 0} empty={<EmptyState title="No positions yet" description="Your holdings appear here after your first UPI payment succeeds." />}>
            {(d) => (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[['Invested', d.totals.investedPaise], ['Expected return', d.totals.expectedReturnPaise], ['Accrued (unrealized)', d.totals.accruedYieldPaise], ['Realized', d.totals.realizedPaise], ['Losses', d.totals.lossPaise]].map(([l, v]) => (
                    <Card key={String(l)}><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-muted">{l}</div><MoneyText paise={Number(v)} compact className="text-lg font-semibold" /></CardContent></Card>
                  ))}
                </div>
                <div className="glass overflow-x-auto rounded-2xl">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-xs text-muted"><tr>{['Invoice', 'Status', 'Units', 'Invested', 'Expected return', 'Accrued', 'Realized', 'Maturity', 'Yield'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {d.positions.map((p) => (
                        <tr key={p.invoiceId} className="cursor-pointer border-t border-border hover:bg-fg/5" onClick={() => setOpen(p.invoiceId)}>
                          <td className="px-3 py-2"><div>{p.supplierName}</div><div className="mono text-[11px] text-muted">{p.invoiceNumberMasked} · {shortId(p.invoiceId)}</div></td>
                          <td className="px-3 py-2"><StatusPill status={p.status} /></td>
                          <td className="mono px-3 py-2">{p.units}</td>
                          <td className="px-3 py-2"><MoneyText paise={p.costPaise} /></td>
                          <td className="px-3 py-2"><MoneyText paise={p.expectedReturnPaise} signed className="text-success" /></td>
                          <td className="px-3 py-2"><MoneyText paise={p.accruedYieldPaise} /></td>
                          <td className="px-3 py-2"><MoneyText paise={p.realizedPaise} />{p.lossPaise > 0 && <span className="ml-1 text-danger">(−<MoneyText paise={p.lossPaise} />)</span>}</td>
                          <td className="mono px-3 py-2">{formatDate(p.dueDate)} <span className="text-muted">({p.tenorDays}d)</span></td>
                          <td className="mono px-3 py-2">{formatBps(p.annualizedYieldBps)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </DataState>
        </TabsContent>
      </Tabs>
      <InvestSheet inv={invest} onClose={() => setInvest(null)} />
      <InvoiceDrawer invoiceId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export default function InvestorPage() {
  return <RequireRole roles={['INVESTOR']}><InvestorDashboard /></RequireRole>;
}
