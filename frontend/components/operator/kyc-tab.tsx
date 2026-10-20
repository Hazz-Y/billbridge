'use client';
import { useState } from 'react';
import { Snowflake, Sun, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { MSP_ORG_NAME } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { KycPill } from '@/components/bb/status-pill';
import { MoneyText } from '@/components/bb/money-text';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { useFreeze, useKyc, useParticipants } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { cn, shortId } from '@/lib/utils';

export function KycTab() {
  const q = useParticipants();
  const kyc = useKyc();
  const freeze = useFreeze();
  const [freezeId, setFreezeId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const fail = (e: unknown) => toast.error('Action failed', { description: errorMessage(e) });

  const decide = (id: string, status: 'APPROVED' | 'REJECTED') =>
    kyc.mutateAsync({ participantId: id, status }).then((p) => toast.success(`KYC ${status.toLowerCase()} for ${p.name}`)).catch(fail);
  const doFreeze = () => {
    if (!freezeId) return;
    freeze.mutateAsync({ participantId: freezeId, frozen: true, reason: reason || 'Operator action' }).then((p) => { toast.warning(`${p.name} frozen`); setFreezeId(null); setReason(''); }).catch(fail);
  };
  const unfreeze = (id: string) => freeze.mutateAsync({ participantId: id, frozen: false }).then((p) => toast.success(`${p.name} unfrozen`)).catch(fail);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={filter === 'PENDING' ? 'primary' : 'outline'} onClick={() => setFilter('PENDING')}>KYC queue</Button>
        <Button size="sm" variant={filter === 'ALL' ? 'primary' : 'outline'} onClick={() => setFilter('ALL')}>All participants</Button>
      </div>
      <DataState query={q} skeleton={<CardSkeleton rows={5} />}>
        {(d) => {
          const items = d.items.filter((p) => filter === 'ALL' || p.kycStatus === 'PENDING');
          if (items.length === 0) return <EmptyState title="Queue is empty" description="No participants are awaiting KYC review." />;
          return (
            <ul className="space-y-2">
              {items.map((p) => (
                <li key={p.id} className={cn('glass flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center md:justify-between', p.frozen && 'border-danger/60 bg-danger/10')}>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Badge tone="neutral">{p.role}</Badge>
                      <KycPill status={p.kycStatus} />
                      {p.frozen && <Badge tone="danger"><Snowflake className="h-3 w-3" /> frozen</Badge>}
                    </div>
                    <div className="text-xs text-muted">{p.orgName} · {p.email} · {MSP_ORG_NAME[p.orgMsp] ?? p.orgMsp}</div>
                    <div className="mono text-[11px] text-muted">id {p.id} · doc sha256 {shortId(p.kycDocHash, 20)}{p.perInvoiceCapPaise > 0 && <> · cap <MoneyText paise={p.perInvoiceCapPaise} compact /></>}</div>
                    {p.frozen && p.frozenReason && <div className="text-xs text-danger">Reason: {p.frozenReason}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.kycStatus !== 'APPROVED' && <Button size="sm" variant="success" loading={kyc.isPending && kyc.variables?.participantId === p.id} onClick={() => decide(p.id, 'APPROVED')}><UserCheck className="h-4 w-4" /> Approve</Button>}
                    {p.kycStatus !== 'REJECTED' && <Button size="sm" variant="outline" loading={kyc.isPending && kyc.variables?.participantId === p.id} onClick={() => decide(p.id, 'REJECTED')}><UserX className="h-4 w-4" /> Reject</Button>}
                    {p.frozen ? <Button size="sm" variant="secondary" loading={freeze.isPending && freeze.variables?.participantId === p.id} onClick={() => unfreeze(p.id)}><Sun className="h-4 w-4" /> Unfreeze</Button>
                      : <Button size="sm" variant="danger" onClick={() => setFreezeId(p.id)}><Snowflake className="h-4 w-4" /> Freeze</Button>}
                  </div>
                </li>
              ))}
            </ul>
          );
        }}
      </DataState>
      <ConfirmDialog open={!!freezeId} onOpenChange={(o) => { if (!o) setFreezeId(null); }} title="Freeze participant?" description="A frozen participant cannot transact; every attempt is recorded as an anomaly." confirmLabel="Freeze" danger loading={freeze.isPending} onConfirm={doFreeze}>
        <div><Label htmlFor="fr">Reason</Label><Input id="fr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. suspicious activity" /></div>
      </ConfirmDialog>
    </div>
  );
}
