'use client';
import { SANDBOX_BANNER } from '@billbridge/shared';
import { Boxes, ShieldAlert } from 'lucide-react';
import { useNetwork } from '@/lib/queries';
import { useLedgerEvents } from '@/lib/ledger-events';
import { cn } from '@/lib/utils';

export function ledgerModeLabel(mode: 'mock' | 'fabric' | 'drunix' | undefined): string {
  if (mode === 'fabric') return 'Ledger: Hyperledger Fabric';
  if (mode === 'drunix') return 'Ledger: Drunix (Fabric-based)';
  return 'Ledger: Mock (Fabric-compatible interface)';
}

/** Reads /api/platform/network; honest about the active ledger mode. */
export function LedgerBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  const q = useNetwork();
  const { connected } = useLedgerEvents();
  const mode = q.data?.ledgerMode;
  const healthy = q.data?.healthy ?? false;
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full border border-border bg-fg/5 px-3 py-1 text-xs', className)} title={q.data ? `${q.data.channel} / ${q.data.chaincode}` : undefined}>
      <span className={cn('h-2 w-2 rounded-full', q.isError ? 'bg-danger' : healthy ? 'bg-success' : 'bg-warning')} aria-hidden />
      <Boxes className="h-3.5 w-3.5 text-muted" aria-hidden />
      <span className={cn(compact && 'hidden sm:inline')}>{q.isError ? 'Ledger: unreachable' : q.isPending ? 'Ledger: connecting…' : ledgerModeLabel(mode)}</span>
      {q.data && <span className="mono text-muted">block #{q.data.blockHeight}</span>}
      {connected && <span className="text-success" title="Live audit stream connected">● live</span>}
    </div>
  );
}

export function SandboxBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-warning/15 px-3 py-1 text-center text-[11px] font-medium tracking-wide text-warning" role="note">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{SANDBOX_BANNER}</span>
    </div>
  );
}
