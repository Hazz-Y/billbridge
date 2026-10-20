'use client';
import type { ReactNode } from 'react';
import { formatBps, type InvoiceSummary } from '@billbridge/shared';
import { Card, CardContent, Field } from '@/components/ui/card';
import { PipelineTracker, ScoreBadge, UnitsProgress } from './indicators';
import { MoneyText } from './money-text';
import { StatusPill } from './status-pill';
import { formatDate, shortId } from '@/lib/utils';
import { cn } from '@/lib/utils';

/** Generic invoice card used by MSME / buyer / operator lists. */
export function InvoiceCard({ inv, onOpen, actions, showPipeline = true, perspective = 'supplier', className }: {
  inv: InvoiceSummary; onOpen?: (id: string) => void; actions?: ReactNode; showPipeline?: boolean; perspective?: 'supplier' | 'buyer' | 'operator'; className?: string;
}) {
  const counterparty = perspective === 'buyer' ? `From ${inv.supplierName}` : perspective === 'operator' ? `${inv.supplierName} → ${inv.buyerName}` : `To ${inv.buyerName}`;
  return (
    <Card className={cn('transition-colors', onOpen && 'cursor-pointer hover:bg-fg/5', className)} onClick={() => onOpen?.(inv.invoiceId)} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(inv.invoiceId); } }}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium">{counterparty}</div>
            <div className="mono text-[11px] text-muted">{shortId(inv.invoiceId, 12)}</div>
          </div>
          <StatusPill status={inv.status} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Face value"><MoneyText paise={inv.faceValuePaise} compact /></Field>
          <Field label="Due"><span className="mono">{formatDate(inv.dueDate)}</span></Field>
          <Field label={inv.discountBps ? 'Yield p.a.' : 'Buyer score'}>{inv.discountBps ? <span className="mono">{formatBps(inv.annualizedYieldBps)}</span> : <ScoreBadge score={inv.buyerScore} />}</Field>
        </div>
        {inv.discountBps > 0 && <UnitsProgress total={inv.totalUnits} sold={inv.unitsSold} reserved={inv.reservedUnits} />}
        {showPipeline && <PipelineTracker status={inv.status} />}
        {actions && <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </CardContent>
    </Card>
  );
}
