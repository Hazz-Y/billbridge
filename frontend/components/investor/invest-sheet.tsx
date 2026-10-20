'use client';
import { useState } from 'react';
import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { expectedReturnPaise, formatBps, type InvoiceSummary, type PaymentIntentResponse } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/bb/money-text';
import { ScoreBadge } from '@/components/bb/indicators';
import { TxBadge, toastTx } from '@/components/bb/tx-badge';
import { UpiPayment } from '@/components/bb/upi-payment';
import { useAuth } from '@/lib/auth';
import { useInvestIntent } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export function InvestSheet({ inv, onClose }: { inv: InvoiceSummary | null; onClose: () => void }) {
  const { user } = useAuth();
  const [units, setUnits] = useState(1);
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  const [doneTx, setDoneTx] = useState<string | null>(null);
  const create = useInvestIntent();

  const reset = () => { setUnits(1); setIntent(null); setDoneTx(null); onClose(); };
  if (!inv) return null;
  const max = Math.max(1, inv.availableUnits);
  const u = Math.min(Math.max(1, units), max);
  const cost = u * inv.pricePerUnitPaise;
  const ret = expectedReturnPaise(u, inv.unitFaceValuePaise, inv.pricePerUnitPaise);
  const cap = user?.perInvoiceCapPaise ?? 0;
  const overCap = cap > 0 && cost > cap;

  const go = () => create.mutateAsync({ invoiceId: inv.invoiceId, units: u })
    .then(setIntent)
    .catch((e) => toast.error('Could not create UPI request', { description: errorMessage(e) }));

  return (
    <Dialog open={!!inv} onOpenChange={(o) => { if (!o) reset(); }}>
      <DialogContent title={intent ? 'Pay with UPI' : 'Invest'} description={`${inv.supplierName} → ${inv.buyerName} · due ${formatDate(inv.dueDate)}`}>
        {!intent ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price per unit"><MoneyText paise={inv.pricePerUnitPaise} /></Field>
              <Field label="Unit face value"><MoneyText paise={inv.unitFaceValuePaise} /></Field>
              <Field label="Annualized yield"><span className="mono">{formatBps(inv.annualizedYieldBps)}</span></Field>
              <Field label="Buyer"><ScoreBadge score={inv.buyerScore} /></Field>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted">Units (1 – {max} available)</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" aria-label="Fewer units" onClick={() => setUnits(Math.max(1, u - 1))}><Minus className="h-4 w-4" /></Button>
                <Input mono type="number" min={1} max={max} value={u} onChange={(e) => setUnits(Math.trunc(Number(e.target.value) || 1))} className="text-center text-lg" />
                <Button variant="outline" size="icon" aria-label="More units" onClick={() => setUnits(Math.min(max, u + 1))}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="mt-2 flex gap-2">{[10, 50, 100, max].filter((n, i, a) => n <= max && a.indexOf(n) === i).map((n) => <button key={n} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-fg/10" onClick={() => setUnits(n)}>{n === max ? 'Max' : n}</button>)}</div>
            </div>
            <div className="glass grid grid-cols-2 gap-3 rounded-xl p-3">
              <Field label="You pay"><MoneyText paise={cost} className="text-lg font-semibold" /></Field>
              <Field label="Expected return at maturity"><MoneyText paise={ret} signed className="text-lg font-semibold text-success" /></Field>
              <Field label="Receive at maturity"><MoneyText paise={cost + ret} /></Field>
              <Field label="Tenor">{inv.tenorDays} days</Field>
            </div>
            {overCap && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /><span>Cost exceeds your per-invoice cap of <MoneyText paise={cap} />. The ledger will reject this with ERR_CAP_EXCEEDED.</span></div>
            )}
            <Button size="lg" className="w-full" loading={create.isPending} onClick={go} disabled={inv.availableUnits === 0}>Create UPI request</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <UpiPayment intent={intent} kindLabel={`for ${intent.units ?? u} units`} onSuccess={(r) => { setDoneTx(r.ledgerTxId); toastTx('Units allocated', r.ledgerTxId ? { txId: r.ledgerTxId } : null, `${intent.units ?? u} units of ${inv.supplierName}`); }} />
            {doneTx && (
              <div className="glass rounded-xl p-3 text-sm">
                <div className="font-medium">Your holding</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <Field label="Units">{intent.units ?? u}</Field>
                  <Field label="Cost"><MoneyText paise={intent.amountPaise} /></Field>
                  <Field label="Expected return"><MoneyText paise={ret} signed className="text-success" /></Field>
                  <Field label="Ledger tx"><TxBadge txId={doneTx} /></Field>
                </div>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={reset}>Done</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
