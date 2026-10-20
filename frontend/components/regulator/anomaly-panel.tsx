'use client';
import { ShieldAlert, Snowflake } from 'lucide-react';
import { GUARD_LABEL } from '@billbridge/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TxBadge } from '@/components/bb/tx-badge';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { useAnomalies, useParticipants } from '@/lib/queries';
import { formatDateTime, shortId } from '@/lib/utils';

export function AnomalyPanel({ onSelectInvoice }: { onSelectInvoice: (id: string) => void }) {
  const q = useAnomalies();
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-danger" /> Anomalies</CardTitle><CardDescription>Rejected attempts recorded on-chain by the guards.</CardDescription></CardHeader>
      <CardContent>
        <DataState query={q} skeleton={<CardSkeleton rows={3} />} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="No anomalies recorded" description="Run an attack from the Demo panel to see a guard fire." />}>
          {(d) => (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {d.items.map((a) => (
                <li key={a.anomalyId} className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{a.kind.replaceAll('_', ' ')}</Badge>
                    <span className="text-xs text-muted">{GUARD_LABEL[a.guard] ?? GUARD_LABEL[a.kind] ?? a.guard}</span>
                  </div>
                  <div className="mt-1 text-xs">{a.detail}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="mono">actor {a.actorId}</span>
                    {a.invoiceRef && <button className="mono underline-offset-2 hover:underline" onClick={() => onSelectInvoice(a.invoiceRef ?? '')}>invoice {shortId(a.invoiceRef, 12)}</button>}
                    <span className="mono text-danger">{a.errorCode}</span>
                    <TxBadge txId={a.txId} size="xs" />
                    <span className="mono">{formatDateTime(a.recordedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}

export function FrozenPanel() {
  const q = useParticipants();
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Snowflake className="h-4 w-4 text-primary" /> Frozen participants</CardTitle></CardHeader>
      <CardContent>
        <DataState query={q} skeleton={<CardSkeleton rows={2} />} isEmpty={(d) => !d.items.some((p) => p.frozen)} empty={<EmptyState title="No frozen participants" />}>
          {(d) => (
            <ul className="space-y-2 text-sm">
              {d.items.filter((p) => p.frozen).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <span><span className="font-medium">{p.name}</span> <Badge tone="neutral">{p.role}</Badge> <span className="mono text-xs text-muted">{p.id}</span></span>
                  <span className="text-xs text-danger">{p.frozenReason ?? 'frozen'}</span>
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}
