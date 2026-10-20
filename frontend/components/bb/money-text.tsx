import { formatBps, formatINR, formatINRCompact } from '@billbridge/shared';
import { cn } from '@/lib/utils';

/** Paise -> ₹ at the render boundary. Never does arithmetic. */
export function MoneyText({ paise, compact = false, whole = false, className, signed = false }: {
  paise: number; compact?: boolean; whole?: boolean; className?: string; signed?: boolean;
}) {
  const safe = Number.isSafeInteger(paise) && paise >= 0 ? paise : 0;
  const text = compact ? formatINRCompact(safe) : formatINR(safe, { whole });
  return (
    <span className={cn('mono tabular-nums', className)} title={formatINR(safe)}>
      {signed && safe > 0 ? '+' : ''}{text}
    </span>
  );
}

export function BpsText({ bps, className }: { bps: number; className?: string }) {
  return <span className={cn('mono tabular-nums', className)}>{formatBps(bps)}</span>;
}
