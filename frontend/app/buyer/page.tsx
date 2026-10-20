'use client';
import { useState } from 'react';
import { CheckCircle2, Inbox, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { InvoiceSummary, PaymentIntentResponse } from '@billbridge/shared';
import { RequireRole, useAuth } from '@/lib/auth';
import { useAcceptInvoice, useInvoices, useRepaymentIntent } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InvoiceCard } from '@/components/bb/invoice-card';
import { InvoiceDrawer } from '@/components/bb/invoice-drawer';
import { CardSkeleton, DataState, EmptyState } from '@/components/bb/states';
import { toastTx } from '@/components/bb/tx-badge';
import { UpiPayment } from '@/components/bb/upi-payment';
import { MoneyText } from '@/components/bb/money-text';
import { ReliabilityCard } from '@/components/buyer/reliability-card';
import { formatDate } from '@/lib/utils';

const PENDING = ['DRAFT'];
const DUE = ['SUPPLIER_PAID', 'LATE'];

function Grid({ items, render }: { items: InvoiceSummary[]; render: (inv: InvoiceSummary) => React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{items.map(render)}</div>;
}

function BuyerDashboard() {
  const { user } = useAuth();
  const invoices = useInvoices({ buyerId: user?.participantId, pageSize: 100 });
  const accept = useAcceptInvoice();
  const intent = useRepaymentIntent();
  const [open, setOpen] = useState<string | null>(null);
  const [pay, setPay] = useState<{ inv: InvoiceSummary; intent: PaymentIntentResponse } | null>(null);
  const [paid, setPaid] = useState(false);

  const doAccept = (id: string) => accept.mutateAsync(id).then((r) => toastTx('Invoice accepted', r.tx, 'The supplier can now be listed for funding.')).catch((e) => toast.error('Accept failed', { description: errorMessage(e) }));
  const startRepay = (inv: InvoiceSummary) => intent.mutateAsync(inv.invoiceId).then((i) => { setPaid(false); setPay({ inv, intent: i }); }).catch((e) => toast.error('Could not create UPI request', { description: errorMessage(e) }));

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">{user?.orgName}</h1><p className="text-sm text-muted">Accept supplier invoices and repay at maturity through UPI.</p></div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending acceptance</TabsTrigger>
            <TabsTrigger value="due">Repayments due</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <DataState query={invoices} skeleton={<div className="mt-4 grid gap-3 md:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>}>
            {(d) => {
              const pending = d.items.filter((i) => PENDING.includes(i.status));
              const due = d.items.filter((i) => DUE.includes(i.status));
              const rest = d.items.filter((i) => !PENDING.includes(i.status) && !DUE.includes(i.status));
              return (
                <>
                  <TabsContent value="pending">
                    {pending.length === 0 ? <EmptyState icon={<Inbox className="h-6 w-6" />} title="Nothing to accept" description="New invoices from your suppliers appear here." /> : (
                      <Grid items={pending} render={(inv) => (
                        <InvoiceCard key={inv.invoiceId} inv={inv} perspective="buyer" onOpen={setOpen} actions={<>
                          <Button size="sm" variant="success" loading={accept.isPending && accept.variables === inv.invoiceId} onClick={() => doAccept(inv.invoiceId)}><CheckCircle2 className="h-4 w-4" /> Accept</Button>
                          <Tooltip content="Disputes are raised off-platform; only the supplier or operator can cancel a draft."><span><Button size="sm" variant="outline" disabled>Dispute</Button></span></Tooltip>
                        </>} />
                      )} />
                    )}
                  </TabsContent>
                  <TabsContent value="due">
                    {due.length === 0 ? <EmptyState icon={<Wallet className="h-6 w-6" />} title="No repayments due" description="Invoices whose supplier has been paid will show here with a UPI request." /> : (
                      <Grid items={due} render={(inv) => (
                        <InvoiceCard key={inv.invoiceId} inv={inv} perspective="buyer" onOpen={setOpen} actions={<>
                          <span className="text-xs text-muted self-center">Repay <MoneyText paise={inv.faceValuePaise} /> by {formatDate(inv.dueDate)}</span>
                          <Button size="sm" loading={intent.isPending && intent.variables === inv.invoiceId} onClick={() => startRepay(inv)}><Wallet className="h-4 w-4" /> Pay via UPI</Button>
                        </>} />
                      )} />
                    )}
                  </TabsContent>
                  <TabsContent value="history">
                    {rest.length === 0 ? <EmptyState title="No history yet" /> : <Grid items={rest} render={(inv) => <InvoiceCard key={inv.invoiceId} inv={inv} perspective="buyer" onOpen={setOpen} />} />}
                  </TabsContent>
                </>
              );
            }}
          </DataState>
        </Tabs>
        <div>{user && <ReliabilityCard buyerId={user.participantId} />}</div>
      </div>
      <InvoiceDrawer invoiceId={open} onClose={() => setOpen(null)} />
      <Dialog open={!!pay} onOpenChange={(o) => { if (!o) setPay(null); }}>
        {pay && (
          <DialogContent title="Repay invoice" description={`${pay.inv.supplierName} · due ${formatDate(pay.inv.dueDate)}`}>
            <UpiPayment intent={pay.intent} kindLabel="repayment" onSuccess={(r) => { setPaid(true); toastTx('Repayment recorded', r.ledgerTxId ? { txId: r.ledgerTxId } : null, 'Investors and the supplier residual have been distributed by the ledger waterfall.'); }} />
            {paid && (
              <div className="rounded-xl border border-border bg-fg/5 p-3 text-sm">
                <div className="font-medium">Distribution summary</div>
                <p className="text-muted">The waterfall paid investors pro-rata by units and any residual to the supplier. Open the invoice to see each distribution with its txId.</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => { setOpen(pay.inv.invoiceId); setPay(null); }}>View payments</Button>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

export default function BuyerPage() {
  return <RequireRole roles={['BUYER']}><BuyerDashboard /></RequireRole>;
}
