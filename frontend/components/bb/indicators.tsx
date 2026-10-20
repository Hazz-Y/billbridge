'use client';
import { PIPELINE_STAGES, scoreBand, type InvoiceStatus } from '@billbridge/shared';
import { Check } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** green >= 85, amber 60-84, red < 60 */
export function ConfidenceBadge({ value, label }: { value: number; label?: string }) {
  const tone: BadgeTone = value >= 85 ? 'success' : value >= 60 ? 'warning' : 'danger';
  return (
    <Tooltip content={`Extraction confidence ${value}%${label ? ` for ${label}` : ''}`}>
      <Badge tone={tone} className="mono">{value}%</Badge>
    </Tooltip>
  );
}

const BAND_COLOR = { HIGH: 'var(--success)', MEDIUM: 'var(--warning)', LOW: 'var(--danger)' } as const;

/** 0-100 radial gauge coloured by band. */
export function ScoreGauge({ score, size = 96, label = 'Reliability' }: { score: number; size?: number; label?: string }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const band = scoreBand(pct);
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${pct} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={10} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BAND_COLOR[band]} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 700ms ease' }}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="mono" fill="currentColor" fontSize={size / 4} fontWeight={700}>{pct}</text>
      </svg>
      <span className="text-[11px] uppercase tracking-wider text-muted">{label} · {band.toLowerCase()}</span>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const band = scoreBand(score);
  const tone: BadgeTone = band === 'HIGH' ? 'success' : band === 'MEDIUM' ? 'warning' : 'danger';
  return <Badge tone={tone} className="mono">Score {score}</Badge>;
}

/** sold / reserved / available bar. */
export function UnitsProgress({ total, sold, reserved = 0, className }: { total: number; sold: number; reserved?: number; className?: string }) {
  const safeTotal = Math.max(1, total);
  const soldPct = Math.min(100, (sold * 100) / safeTotal);
  const resPct = Math.min(100 - soldPct, (reserved * 100) / safeTotal);
  const available = Math.max(0, total - sold - reserved);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={sold}>
        <div className="bg-success transition-all" style={{ width: `${soldPct}%` }} />
        <div className="bg-warning/80 transition-all" style={{ width: `${resPct}%` }} />
      </div>
      <div className="mono flex justify-between text-[11px] text-muted">
        <span><span className="text-success">{sold}</span> sold{reserved > 0 && <> · <span className="text-warning">{reserved}</span> reserved</>}</span>
        <span>{available} / {total} available</span>
      </div>
    </div>
  );
}

const TERMINAL_BAD: InvoiceStatus[] = ['CANCELLED', 'DEFAULTED'];

/** Draft → Accepted → Listed → Funded → Paid → Settled */
export function PipelineTracker({ status, compact = false }: { status: InvoiceStatus; compact?: boolean }) {
  const idx = PIPELINE_STAGES.findIndex((s) => s.statuses.includes(status));
  const bad = TERMINAL_BAD.includes(status);
  return (
    <ol className={cn('flex w-full items-center', compact ? 'gap-0' : 'gap-0')} aria-label="Invoice pipeline">
      {PIPELINE_STAGES.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const color = bad && active ? 'bg-danger border-danger text-white' : done ? 'bg-success border-success text-white' : active ? 'bg-primary border-primary text-white' : 'border-border bg-transparent text-muted';
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div className={cn('flex items-center justify-center rounded-full border-2 text-[10px] font-bold', compact ? 'h-4 w-4' : 'h-6 w-6', color)}>
                {done ? <Check className={compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} /> : compact ? '' : i + 1}
              </div>
              {!compact && <span className={cn('mt-1 text-[10px] whitespace-nowrap', active ? 'text-fg font-medium' : 'text-muted')}>{s.label}</span>}
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={cn('mx-1 h-0.5 flex-1', i < idx ? 'bg-success' : 'bg-border', !compact && 'mb-4')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
