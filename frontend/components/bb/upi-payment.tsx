'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, ExternalLink, Loader2, Smartphone, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentIntentResponse, WebhookResult } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { MoneyText } from './money-text';
import { TxBadge } from './tx-badge';
import { useSimulatePayment } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export type PayStep = 'INITIATED' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
const STEPS: PayStep[] = ['INITIATED', 'PROCESSING', 'SUCCESS'];

export function PaymentStepper({ step }: { step: PayStep }) {
  const idx = step === 'FAILED' ? 1 : STEPS.indexOf(step);
  return (
    <ol className="flex items-center gap-2" aria-label="Payment state">
      {STEPS.map((s, i) => {
        const done = i < idx || (step === 'SUCCESS' && i === idx);
        const active = i === idx && step !== 'SUCCESS';
        const failed = step === 'FAILED' && i === 2;
        return (
          <li key={s} className="flex items-center gap-2">
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold',
              failed ? 'border-danger bg-danger text-white' : done ? 'border-success bg-success text-white' : active ? 'border-primary bg-primary text-white' : 'border-border text-muted')}>
              {failed ? <XCircle className="h-3.5 w-3.5" /> : done ? <Check className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
            </span>
            <span className={cn('text-xs', done || active ? 'text-fg' : 'text-muted')}>{failed ? 'FAILED' : s}</span>
            {i < STEPS.length - 1 && <span className={cn('h-px w-6', done ? 'bg-success' : 'bg-border')} />}
          </li>
        );
      })}
    </ol>
  );
}

function useCountdown(expiresAt: string): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

/** QR (≥240px) + deeplink + upiRef + expiry + "Simulate payment" stepper. Calls onSuccess with the webhook result. */
export function UpiPayment({ intent, onSuccess, onFailed, kindLabel = 'payment' }: {
  intent: PaymentIntentResponse; onSuccess: (r: WebhookResult) => void; onFailed?: (r: WebhookResult) => void; kindLabel?: string;
}) {
  const [step, setStep] = useState<PayStep>('INITIATED');
  const [result, setResult] = useState<WebhookResult | null>(null);
  const left = useCountdown(intent.expiresAt);
  const simulate = useSimulatePayment();

  const run = async (fail = false) => {
    setStep('PROCESSING');
    try {
      const r = await simulate.mutateAsync({ upiRef: intent.upiRef, fail });
      setResult(r);
      if (r.status === 'SUCCESS') { setStep('SUCCESS'); onSuccess(r); }
      else { setStep('FAILED'); onFailed?.(r); toast.error(`Payment ${r.status.toLowerCase().replaceAll('_', ' ')}`, { description: r.message ?? r.errorCode ?? undefined }); }
    } catch (e) {
      setStep('FAILED');
      toast.error('Simulation failed', { description: errorMessage(e) });
    }
  };

  const mm = Math.floor(left / 60);
  const ss = (left % 60).toString().padStart(2, '0');

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-2xl bg-white p-3 shadow-inner">
        <QRCodeSVG value={intent.deeplink} size={240} level="M" includeMargin={false} />
      </div>
      <div className="text-center">
        <div className="text-xs uppercase tracking-wider text-muted">Pay {kindLabel}</div>
        <MoneyText paise={intent.amountPaise} className="text-2xl font-bold" />
        <div className="mono mt-1 text-xs text-muted">to {intent.payeeVpa} · {intent.payeeName}</div>
        <div className="mono mt-1 text-[11px] text-muted">ref {intent.upiRef}</div>
        <div className={cn('mono mt-1 text-xs', left === 0 ? 'text-danger' : left < 60 ? 'text-warning' : 'text-muted')}>
          {left === 0 ? 'Request expired' : `expires in ${mm}:${ss}`}
        </div>
      </div>
      <PaymentStepper step={step} />
      {step === 'SUCCESS' && result ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
          <span className="font-medium text-success">Payment confirmed and recorded on the ledger</span>
          <TxBadge txId={result.ledgerTxId} />
        </div>
      ) : (
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          <a href={intent.deeplink} className="tap inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-fg/5 px-4 text-sm font-medium hover:bg-fg/10">
            <Smartphone className="h-4 w-4" /> Open UPI app <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          <Button onClick={() => run(false)} loading={step === 'PROCESSING'} disabled={left === 0}>Simulate payment</Button>
          {step === 'FAILED' && <Button variant="outline" className="sm:col-span-2" onClick={() => run(false)}>Retry</Button>}
        </div>
      )}
    </div>
  );
}
