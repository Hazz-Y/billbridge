'use client';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { formatBps, formatINRCompact } from '@billbridge/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MoneyText } from '@/components/bb/money-text';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { useReconciliation, useStats, useInvoices } from '@/lib/queries';
import { formatDateTime, shortId } from '@/lib/utils';

export function ReconciliationTab() {
  const q = useReconciliation();
  return (
    <DataState query={q} skeleton={<CardSkeleton rows={5} />} isEmpty={(d) => d.rows.length === 0} empty={<EmptyState title="Nothing to reconcile" description="UPI transactions are compared against ledger payment records." />}>
      {(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[['Checked', d.summary.total, 'neutral'], ['Matched', d.summary.matched, 'success'], ['Flagged', d.summary.flagged, 'danger']].map(([l, v, tone]) => (
              <Card key={String(l)}><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-muted">{l}</div><div className={`mono text-2xl font-bold text-${tone}`}>{v}</div></CardContent></Card>
            ))}
          </div>
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted"><tr>{['', 'UPI ref', 'Invoice', 'Kind', 'Ledger amount', 'UPI amount', 'Ledger / UPI status', 'Reason'].map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {d.rows.map((r) => {
                  const ok = r.classification === 'MATCHED';
                  return (
                    <tr key={r.upiRef} className={ok ? 'border-t border-border' : 'border-t border-border bg-danger/5'}>
                      <td className="px-3 py-2">{ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="matched" /> : <AlertTriangle className="h-4 w-4 text-danger" aria-label="flagged" />}</td>
                      <td className="mono px-3 py-2 text-xs">{r.upiRef}</td>
                      <td className="mono px-3 py-2 text-xs text-muted">{shortId(r.invoiceId)}</td>
                      <td className="px-3 py-2"><Badge tone="neutral">{r.kind}</Badge></td>
                      <td className="px-3 py-2">{r.ledgerAmountPaise === null ? <span className="text-muted">—</span> : <MoneyText paise={r.ledgerAmountPaise} />}</td>
                      <td className="px-3 py-2">{r.upiAmountPaise === null ? <span className="text-muted">—</span> : <MoneyText paise={r.upiAmountPaise} />}</td>
                      <td className="mono px-3 py-2 text-xs">{r.ledgerStatus ?? '—'} / {r.upiStatus ?? '—'}</td>
                      <td className="px-3 py-2 text-xs"><Badge tone={ok ? 'success' : 'danger'}>{r.classification}</Badge> <span className="text-muted">{r.reason}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted">Checked at {formatDateTime(d.checkedAt)}</div>
        </div>
      )}
    </DataState>
  );
}

export function HealthTab() {
  const stats = useStats(5000);
  const inv = useInvoices({ pageSize: 200 });
  return (
    <DataState query={stats} skeleton={<CardSkeleton rows={4} />}>
      {(s) => {
        const byStatus = new Map<string, number>();
        for (const i of inv.data?.items ?? []) byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + i.faceValuePaise);
        const data = [...byStatus.entries()].map(([status, paise]) => ({ status: status.replaceAll('_', ' ').toLowerCase(), rupees: Math.trunc(paise / 100) }));
        const tiles: Array<[string, string]> = [
          ['Total invoices', String(s.totalInvoices)], ['Active', String(s.activeInvoices)], ['Settled', String(s.settledInvoices)],
          ['Total funded', formatINRCompact(s.totalFundedPaise)], ['Total face value', formatINRCompact(s.totalFaceValuePaise)], ['Active investors', String(s.activeInvestors)],
          ['Avg yield', formatBps(s.avgYieldBps)], ['Default rate', formatBps(s.defaultRateBps)], ['Block height', String(s.blockHeight)],
        ];
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {tiles.map(([l, v]) => <Card key={l}><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wider text-muted">{l}</div><div className="mono text-xl font-semibold">{v}</div></CardContent></Card>)}
            </div>
            <Card>
              <CardHeader><CardTitle>Face value by status (₹)</CardTitle></CardHeader>
              <CardContent className="h-64">
                {data.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <XAxis dataKey="status" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval={0} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatINRCompact(v * 100)} width={70} />
                      <ChartTooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => formatINRCompact(v * 100)} />
                      <Bar dataKey="rupees" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-sm text-muted">No invoices yet</div>}
              </CardContent>
            </Card>
            <div className="mono text-xs text-muted">ledger {s.ledgerMode} · simulated now {formatDateTime(s.simulatedNow)} (offset {s.clockOffsetSeconds}s) · cached {formatDateTime(s.cachedAt)}</div>
          </div>
        );
      }}
    </DataState>
  );
}
