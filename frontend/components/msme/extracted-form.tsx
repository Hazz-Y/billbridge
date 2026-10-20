'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { formatINR, isValidGstin, parseDecimalToPaise, paiseToDecimalString, type LineItem, type UploadResponse } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfidenceBadge } from '@/components/bb/indicators';
import { MoneyText } from '@/components/bb/money-text';
import { cn } from '@/lib/utils';

export interface ExtractedFormValue {
  supplierGstin: string; buyerGstin: string; invoiceNumber: string; issueDate: string; dueDate: string;
  faceValuePaise: number; taxAmountPaise: number; lineItems: LineItem[];
}

function MoneyInput({ value, onChange, id, invalid }: { value: number; onChange: (p: number) => void; id?: string; invalid?: boolean }) {
  const [text, setText] = useState(paiseToDecimalString(value));
  return (
    <Input id={id} mono inputMode="decimal" value={text} invalid={invalid}
      onChange={(e) => { setText(e.target.value); const p = parseDecimalToPaise(e.target.value); if (p !== null) onChange(p); }}
      onBlur={() => { const p = parseDecimalToPaise(text); setText(paiseToDecimalString(p ?? value)); }} />
  );
}

export function toFormValue(u: UploadResponse): ExtractedFormValue {
  const x = u.extraction;
  return {
    supplierGstin: x.supplierGstin.toUpperCase(), buyerGstin: x.buyerGstin.toUpperCase(), invoiceNumber: x.invoiceNumber,
    issueDate: x.invoiceDate.slice(0, 10), dueDate: x.dueDate.slice(0, 10), faceValuePaise: x.totalAmountPaise, taxAmountPaise: x.taxAmountPaise,
    lineItems: x.lineItems.length ? x.lineItems : [{ description: '', quantity: 1, unitPricePaise: 0, totalPaise: 0 }],
  };
}

function F({ conf, k, label, children }: { conf: Record<string, number>; k: string; label: string; children: React.ReactNode }) {
  const c = conf[k];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><Label htmlFor={k} className="mb-0">{label}</Label>{typeof c === 'number' && <ConfidenceBadge value={c} label={label} />}</div>
      {children}
    </div>
  );
}

export function ExtractedForm({ upload, value, onChange, onSubmit, submitting, buyerName }: {
  upload: UploadResponse; value: ExtractedFormValue; onChange: (v: ExtractedFormValue) => void; onSubmit: () => void; submitting: boolean; buyerName: string | null;
}) {
  const conf = upload.extraction.fieldConfidence;
  const set = <K extends keyof ExtractedFormValue>(k: K, v: ExtractedFormValue[K]) => onChange({ ...value, [k]: v });
  const setItem = (i: number, patch: Partial<LineItem>) => {
    const items = value.lineItems.map((li, j) => {
      if (j !== i) return li;
      const next = { ...li, ...patch };
      if (patch.quantity !== undefined || patch.unitPricePaise !== undefined) next.totalPaise = next.quantity * next.unitPricePaise;
      return next;
    });
    set('lineItems', items);
  };

  const itemsSum = useMemo(() => value.lineItems.reduce((a, li) => a + li.totalPaise, 0), [value.lineItems]);
  const computedTotal = itemsSum + value.taxAmountPaise;
  const totalsOk = computedTotal === value.faceValuePaise;
  const unitOk = value.faceValuePaise > 0 && value.faceValuePaise % 100_000 === 0;
  const gstinOk = isValidGstin(value.supplierGstin) && isValidGstin(value.buyerGstin);
  const datesOk = value.dueDate > value.issueDate;
  const canSubmit = totalsOk && unitOk && gstinOk && datesOk && !!upload.buyerId && value.invoiceNumber.trim().length > 0 && value.lineItems.every((li) => li.description.trim());

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Extracted fields</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Badge tone={upload.extraction.source === 'GEMINI' ? 'primary' : 'muted'}>{upload.extraction.source === 'GEMINI' ? 'AI extraction' : 'Fallback parser'}</Badge>
            <ConfidenceBadge value={upload.extraction.confidence} label="overall" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {upload.extraction.warnings.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
              {upload.extraction.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />{w}</li>)}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <F conf={conf} k="supplierGstin" label="Supplier GSTIN"><Input id="supplierGstin" mono maxLength={15} value={value.supplierGstin} onChange={(e) => set('supplierGstin', e.target.value.toUpperCase())} invalid={!isValidGstin(value.supplierGstin)} /></F>
            <F conf={conf} k="buyerGstin" label="Buyer GSTIN"><Input id="buyerGstin" mono maxLength={15} value={value.buyerGstin} onChange={(e) => set('buyerGstin', e.target.value.toUpperCase())} invalid={!isValidGstin(value.buyerGstin)} /></F>
            <F conf={conf} k="invoiceNumber" label="Invoice number"><Input id="invoiceNumber" mono value={value.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} invalid={!value.invoiceNumber.trim()} /></F>
            <div>
              <Label>Buyer (resolved from GSTIN)</Label>
              <div className={cn('flex h-11 items-center rounded-xl border px-3 text-sm', upload.buyerId ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10 text-danger')}>
                {buyerName ?? 'No platform participant with this GSTIN — ask the buyer to register'}
              </div>
            </div>
            <F conf={conf} k="invoiceDate" label="Issue date"><Input id="invoiceDate" type="date" mono value={value.issueDate} onChange={(e) => set('issueDate', e.target.value)} /></F>
            <F conf={conf} k="dueDate" label="Due date"><Input id="dueDate" type="date" mono value={value.dueDate} onChange={(e) => set('dueDate', e.target.value)} invalid={!datesOk} /></F>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Line items</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => set('lineItems', [...value.lineItems, { description: '', quantity: 1, unitPricePaise: 0, totalPaise: 0 }])}><Plus className="h-4 w-4" /> Add</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Description</th><th className="pb-2 w-20">Qty</th><th className="pb-2 w-32">Unit ₹</th><th className="pb-2 w-32 text-right">Total</th><th className="w-10" /></tr></thead>
            <tbody>
              {value.lineItems.map((li, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 pr-2"><Input value={li.description} onChange={(e) => setItem(i, { description: e.target.value })} invalid={!li.description.trim()} className="h-10" /></td>
                  <td className="py-1 pr-2"><Input mono type="number" min={0} value={li.quantity} onChange={(e) => setItem(i, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} className="h-10" /></td>
                  <td className="py-1 pr-2"><MoneyInput value={li.unitPricePaise} onChange={(p) => setItem(i, { unitPricePaise: p })} /></td>
                  <td className="py-1 text-right"><MoneyText paise={li.totalPaise} /></td>
                  <td className="py-1 text-right"><button aria-label="Remove line" className="tap inline-flex items-center justify-center rounded-lg text-muted hover:text-danger" onClick={() => set('lineItems', value.lineItems.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div><Label>Σ line items</Label><div className="flex h-11 items-center rounded-xl border border-border px-3"><MoneyText paise={itemsSum} /></div></div>
            <F conf={conf} k="taxAmountPaise" label="Tax (GST)"><MoneyInput id="taxAmountPaise" value={value.taxAmountPaise} onChange={(p) => set('taxAmountPaise', p)} /></F>
            <F conf={conf} k="totalAmountPaise" label="Invoice total (face value)"><MoneyInput id="totalAmountPaise" value={value.faceValuePaise} onChange={(p) => set('faceValuePaise', p)} invalid={!totalsOk || !unitOk} /></F>
          </div>
          <div className={cn('mt-3 flex items-center gap-2 rounded-xl border p-3 text-sm', totalsOk ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10')}>
            {totalsOk ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-danger" />}
            <span className="mono">{formatINR(itemsSum)} + {formatINR(value.taxAmountPaise)} = {formatINR(computedTotal)}</span>
            <span className="text-muted">{totalsOk ? 'matches face value' : `≠ ${formatINR(value.faceValuePaise)} (difference ${formatINR(Math.abs(computedTotal - value.faceValuePaise))})`}</span>
          </div>
          {!unitOk && <p className="mt-2 text-xs text-danger">Face value must be a positive multiple of ₹1,000 (one unit = ₹1,000).</p>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="mono text-[11px] text-muted">file {upload.fileName} · sha256 {upload.fileHash.slice(0, 16)}… · {(upload.sizeBytes / 1024).toFixed(0)} KB</p>
        <Button size="lg" onClick={onSubmit} disabled={!canSubmit} loading={submitting}>Confirm & tokenize</Button>
      </div>
    </div>
  );
}
