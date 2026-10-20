'use client';
import { useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip } from '@/components/ui/tooltip';
import { cn, copyToClipboard, shortId } from '@/lib/utils';

/** Short txId + block number; click copies the full id; tooltip shows the full id. */
export function TxBadge({ txId, blockNumber, className, size = 'sm' }: { txId: string | null | undefined; blockNumber?: number | null; className?: string; size?: 'sm' | 'xs' }) {
  const [copied, setCopied] = useState(false);
  if (!txId) return <span className={cn('mono text-xs text-muted', className)}>no tx</span>;
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyToClipboard(txId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };
  return (
    <Tooltip content={<span className="mono break-all">{txId}{typeof blockNumber === 'number' ? ` · block #${blockNumber}` : ''}</span>}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'mono inline-flex items-center gap-1 rounded-md border border-border bg-fg/5 px-1.5 text-muted hover:bg-fg/10 hover:text-fg',
          size === 'sm' ? 'h-6 text-[11px]' : 'h-5 text-[10px]', className,
        )}
        aria-label={`Transaction ${txId}`}
      >
        <Link2 className="h-3 w-3" aria-hidden />
        {shortId(txId, 10)}
        {typeof blockNumber === 'number' && <span className="text-primary">#{blockNumber}</span>}
        {copied ? <Check className="h-3 w-3 text-success" aria-hidden /> : <Copy className="h-3 w-3 opacity-60" aria-hidden />}
      </button>
    </Tooltip>
  );
}

/** Toast helper every mutation uses: title + TxBadge. */
export function toastTx(title: string, tx: { txId: string; blockNumber?: number } | null | undefined, description?: string) {
  toast.success(title, {
    description: (
      <div className="flex flex-col gap-1">
        {description && <span>{description}</span>}
        {tx && <TxBadge txId={tx.txId} blockNumber={tx.blockNumber} />}
      </div>
    ),
  });
}
