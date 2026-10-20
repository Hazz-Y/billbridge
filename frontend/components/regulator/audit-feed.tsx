'use client';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Search } from 'lucide-react';
import type { SseEvent } from '@billbridge/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { TxBadge } from '@/components/bb/tx-badge';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { useAuditEvents } from '@/lib/queries';
import { useLedgerEvents } from '@/lib/ledger-events';
import { auditCsvUrl } from '@/lib/api';
import { cn, formatTime, shortId } from '@/lib/utils';

const ROLE_TONE: Record<string, 'primary' | 'success' | 'warning' | 'neutral' | 'danger'> = { OPERATOR: 'primary', MSME: 'success', BUYER: 'warning', INVESTOR: 'neutral', REGULATOR: 'danger' };

export function AuditFeed({ onSelectInvoice, selected }: { onSelectInvoice: (id: string) => void; selected: string | null }) {
  const initial = useAuditEvents({ pageSize: 100 });
  const { events: live, connected } = useLedgerEvents();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const all: SseEvent[] = [];
    for (const e of [...live, ...(initial.data?.items ?? [])]) {
      if (seen.has(e.txId)) continue;
      seen.add(e.txId);
      all.push(e);
    }
    all.sort((a, b) => b.blockNumber - a.blockNumber || b.seq - a.seq);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((e) => [e.fn, e.actorId, e.actorRole, e.txId, e.invoiceId ?? ''].some((s) => s.toLowerCase().includes(needle))) : all;
  }, [live, initial.data, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by fn, actor, tx, invoice…" className="pl-9" />
        </div>
        <Badge tone={connected ? 'success' : 'warning'}>{connected ? '● live stream' : 'stream reconnecting'}</Badge>
        <a href={auditCsvUrl()} target="_blank" rel="noreferrer" className="tap inline-flex items-center gap-2 rounded-xl border border-border px-3 text-sm hover:bg-fg/10"><Download className="h-4 w-4" /> CSV</a>
      </div>
      <DataState query={initial} skeleton={<CardSkeleton rows={6} />}>
        {() => rows.length === 0 ? <EmptyState title="No audit events" description="Every chaincode transaction will appear here as it is committed." /> : (
          <div className="glass overflow-hidden rounded-2xl">
            <div className="hidden grid-cols-[90px_1fr_1fr_1fr_110px_80px] gap-2 border-b border-border px-3 py-2 text-[11px] uppercase tracking-wider text-muted md:grid"><span>Block</span><span>Function</span><span>Actor</span><span>Invoice</span><span>Tx</span><span>Time</span></div>
            <ul className="max-h-[60vh] overflow-y-auto">
              <AnimatePresence initial={false}>
                {rows.map((e) => (
                  <motion.li key={e.txId} layout initial={{ opacity: 0, y: -12, backgroundColor: 'rgba(59,130,246,0.25)' }} animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} transition={{ duration: 0.5 }}
                    className={cn('grid grid-cols-2 gap-2 border-b border-border px-3 py-2 text-sm md:grid-cols-[90px_1fr_1fr_1fr_110px_80px]', e.invoiceId && 'cursor-pointer hover:bg-fg/5', selected && e.invoiceId === selected && 'bg-primary/10')}
                    onClick={() => e.invoiceId && onSelectInvoice(e.invoiceId)}>
                    <span className="mono text-primary">#{e.blockNumber}</span>
                    <span className="font-medium">{e.fn}<span className="ml-1 text-[10px] text-muted">{e.events.map((s) => s.type).join(', ')}</span></span>
                    <span className="truncate"><Badge tone={ROLE_TONE[e.actorRole] ?? 'neutral'}>{e.actorRole}</Badge> <span className="mono text-xs">{e.actorId}</span></span>
                    <span className="mono text-xs text-muted">{e.invoiceId ? shortId(e.invoiceId, 12) : '—'}</span>
                    <span><TxBadge txId={e.txId} size="xs" /></span>
                    <span className="mono text-xs text-muted">{formatTime(e.timestamp)}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </DataState>
    </div>
  );
}
