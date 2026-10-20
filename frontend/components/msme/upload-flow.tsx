'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileUp, Loader2, ShieldX, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { GUARD_LABEL, type InvoiceStatus, type UploadResponse } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusPill } from '@/components/bb/status-pill';
import { TxBadge, toastTx } from '@/components/bb/tx-badge';
import { useCreateInvoice, useUpload } from '@/lib/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { cn, shortId } from '@/lib/utils';
import { ExtractedForm, toFormValue, type ExtractedFormValue } from './extracted-form';

const STEPS = ['Reading document', 'Extracting fields', 'Validating GSTIN', 'Checking totals'];
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg'];

const GUARD_FROM_CODE: Record<string, string> = {
  ERR_DUPLICATE_INVOICE_ID: 'DUPLICATE_INVOICE_ID', ERR_DUPLICATE_INVOICE_CONTENT: 'DUPLICATE_CONTENT', ERR_DUPLICATE_FILE: 'DUPLICATE_FILE',
  IDENTITY: 'DUPLICATE_INVOICE_ID', CONTENT: 'DUPLICATE_CONTENT', FILE: 'DUPLICATE_FILE',
};

interface Duplicate { code: string; guard: string; message: string; existingId: string | null; existingStatus: InvoiceStatus | null; txId: string | null }

function str(v: unknown): string | null { return typeof v === 'string' ? v : null; }

function toDuplicate(e: unknown): Duplicate | null {
  if (!isApiError(e) || e.status !== 409 || !e.code.startsWith('ERR_DUPLICATE_')) return null;
  const d = e.details;
  const guardRaw = str(d.guard) ?? e.code;
  return {
    code: e.code, guard: GUARD_FROM_CODE[guardRaw] ?? GUARD_FROM_CODE[e.code] ?? guardRaw, message: e.message,
    existingId: str(d.existingInvoiceId) ?? str(d.invoiceId) ?? str(d.clashingInvoiceId), existingStatus: (str(d.existingStatus) ?? str(d.status)) as InvoiceStatus | null,
    txId: str(d.anomalyTxId) ?? str(d.txId),
  };
}

function Steps({ active, done }: { active: number; done: boolean }) {
  return (
    <ol className="space-y-2">
      {STEPS.map((s, i) => {
        const state = done || i < active ? 'done' : i === active ? 'active' : 'todo';
        return (
          <li key={s} className={cn('flex items-center gap-3 text-sm', state === 'todo' && 'text-muted')}>
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border', state === 'done' ? 'border-success bg-success text-white' : state === 'active' ? 'border-primary text-primary' : 'border-border')}>
              {state === 'done' ? <Check className="h-3.5 w-3.5" /> : state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
            </span>
            {s}
          </li>
        );
      })}
    </ol>
  );
}

export function DuplicateCard({ dup, onDismiss, onOpen }: { dup: Duplicate; onDismiss: () => void; onOpen?: (id: string) => void }) {
  return (
    <div className="w-full rounded-2xl border-2 border-danger bg-danger/10 p-5" role="alert">
      <div className="flex items-start gap-3">
        <ShieldX className="mt-0.5 h-7 w-7 shrink-0 text-danger" />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-lg font-semibold text-danger">Blocked by the ledger: already tokenized</h3>
          <p className="text-sm">{GUARD_LABEL[dup.guard] ?? dup.guard}</p>
          <p className="text-sm text-muted">{dup.message}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="mono rounded-md bg-danger/20 px-2 py-0.5 text-danger">{dup.code}</span>
            {dup.existingId && (
              <button className="mono rounded-md border border-border px-2 py-0.5 hover:bg-fg/10" onClick={() => onOpen?.(dup.existingId ?? '')}>clashes with {shortId(dup.existingId, 12)}</button>
            )}
            {dup.existingStatus && <StatusPill status={dup.existingStatus} />}
            {dup.txId && <TxBadge txId={dup.txId} />}
          </div>
          <p className="text-xs text-muted">The rejected attempt was recorded on-chain as an anomaly visible to the regulator.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
}

export function UploadFlow({ onCreated, onOpenInvoice }: { onCreated: (invoiceId: string) => void; onOpenInvoice?: (id: string) => void }) {
  const upload = useUpload();
  const create = useCreateInvoice();
  const [step, setStep] = useState(0);
  const [drag, setDrag] = useState(false);
  const [uploaded, setUploaded] = useState<UploadResponse | null>(null);
  const [form, setForm] = useState<ExtractedFormValue | null>(null);
  const [dup, setDup] = useState<Duplicate | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Step timings while the real request is in flight; the last step waits for the response.
  useEffect(() => {
    if (!upload.isPending) return;
    setStep(0);
    const timers = [600, 1400, 2300].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [upload.isPending]);

  const pick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.includes(file.type) && !/\.(pdf|png|jpe?g)$/i.test(file.name)) return toast.error('Unsupported file', { description: 'Upload a PDF, PNG or JPG.' });
    if (file.size > MAX_BYTES) return toast.error('File too large', { description: 'Maximum size is 10 MB.' });
    setDup(null);
    try {
      const r = await upload.mutateAsync(file);
      setUploaded(r);
      setForm(toFormValue(r));
      toast.success('Document read', { description: `${r.extraction.lineItems.length} line items · confidence ${r.extraction.confidence}%` });
    } catch (e) {
      const d = toDuplicate(e);
      if (d) setDup(d); else toast.error('Upload failed', { description: errorMessage(e) });
    }
  }, [upload]);

  const submit = async () => {
    if (!uploaded || !form || !uploaded.buyerId) return;
    setDup(null);
    try {
      const r = await create.mutateAsync({ fileId: uploaded.fileId, buyerId: uploaded.buyerId, ...form });
      toastTx('Invoice tokenized', r.tx, `Invoice ${shortId(r.invoice.invoiceId, 12)} · ${r.invoice.totalUnits} units`);
      setUploaded(null); setForm(null);
      onCreated(r.invoice.invoiceId);
    } catch (e) {
      const d = toDuplicate(e);
      if (d) setDup(d); else toast.error('Tokenization failed', { description: errorMessage(e) });
    }
  };

  return (
    <div className="space-y-4">
      {dup && <DuplicateCard dup={dup} onDismiss={() => setDup(null)} onOpen={onOpenInvoice} />}
      {!uploaded && (
        <Card>
          <CardContent className="p-5">
            {upload.isPending ? (
              <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-around">
                <div className="flex items-center gap-3"><FileUp className="h-8 w-8 text-primary" /><div><div className="font-medium">Processing invoice…</div><div className="text-xs text-muted">Extraction runs on the backend; hashing happens there too.</div></div></div>
                <Steps active={step} done={false} />
              </div>
            ) : (
              <div
                role="button" tabIndex={0}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
                onClick={() => inputRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
                className={cn('flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors', drag ? 'border-primary bg-primary/10' : 'border-border hover:bg-fg/5')}
              >
                <UploadCloud className="h-9 w-9 text-primary" />
                <div className="font-medium">Drop your invoice here or tap to browse</div>
                <div className="text-xs text-muted">PDF, PNG or JPG · up to 10 MB · try samples/invoice-aurora-001.pdf</div>
                <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {uploaded && form && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review & confirm</h2>
            <Button variant="ghost" size="sm" onClick={() => { setUploaded(null); setForm(null); }}>Start over</Button>
          </div>
          <ExtractedForm upload={uploaded} value={form} onChange={setForm} onSubmit={submit} submitting={create.isPending} buyerName={uploaded.buyerName} />
        </>
      )}
    </div>
  );
}
