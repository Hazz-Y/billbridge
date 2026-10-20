'use client';
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { RequireRole, useAuth } from '@/lib/auth';
import { useCancelInvoice, useInvoices } from '@/lib/queries';
import { UploadFlow } from '@/components/msme/upload-flow';
import { InvoiceCard } from '@/components/bb/invoice-card';
import { InvoiceDrawer } from '@/components/bb/invoice-drawer';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { toastTx } from '@/components/bb/tx-badge';
import { errorMessage } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function MsmeDashboard() {
  const { user } = useAuth();
  const invoices = useInvoices({ supplierId: user?.participantId, pageSize: 100 });
  const cancel = useCancelInvoice();
  const [open, setOpen] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState('upload');

  const doCancel = () => {
    if (!cancelId) return;
    cancel.mutateAsync({ id: cancelId, reason: reason || 'Cancelled by supplier' })
      .then((r) => { toastTx('Invoice cancelled', r.tx); setCancelId(null); setReason(''); })
      .catch((e) => toast.error('Cancel failed', { description: errorMessage(e) }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{user?.orgName}</h1>
          <p className="text-sm text-muted">Tokenize invoices and track them from upload to settlement.</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upload">Upload invoice</TabsTrigger>
          <TabsTrigger value="list">My invoices {invoices.data ? `(${invoices.data.items.length})` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <UploadFlow onCreated={(id) => { setTab('list'); setOpen(id); }} onOpenInvoice={setOpen} />
        </TabsContent>
        <TabsContent value="list">
          <DataState query={invoices} isEmpty={(d) => d.items.length === 0} skeleton={<div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>}
            empty={<EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices yet" description="Upload your first GST invoice to tokenize it." action={<Button onClick={() => setTab('upload')}>Upload invoice</Button>} />}>
            {(d) => (
              <div className="grid gap-3 md:grid-cols-2">
                {d.items.map((inv) => (
                  <InvoiceCard key={inv.invoiceId} inv={inv} onOpen={setOpen}
                    actions={(inv.status === 'DRAFT' || inv.status === 'LISTED') ? <Button size="sm" variant="outline" onClick={() => setCancelId(inv.invoiceId)}>Cancel</Button> : undefined} />
                ))}
              </div>
            )}
          </DataState>
        </TabsContent>
      </Tabs>
      <InvoiceDrawer invoiceId={open} onClose={() => setOpen(null)} />
      <ConfirmDialog open={!!cancelId} onOpenChange={(o) => { if (!o) setCancelId(null); }} title="Cancel this invoice?" description="Only DRAFT or LISTED invoices with no funding can be cancelled." confirmLabel="Cancel invoice" danger loading={cancel.isPending} onConfirm={doCancel}>
        <div><Label htmlFor="reason">Reason</Label><Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. issued in error" /></div>
      </ConfirmDialog>
    </div>
  );
}

export default function MsmePage() {
  return <RequireRole roles={['MSME']}><MsmeDashboard /></RequireRole>;
}
