'use client';
import { useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { RequireRole, useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InvoiceDetailBody } from '@/components/bb/invoice-drawer';
import { EmptyState } from '@/components/bb/states';
import { AuditFeed } from '@/components/regulator/audit-feed';
import { AnomalyPanel, FrozenPanel } from '@/components/regulator/anomaly-panel';
import { shortId } from '@/lib/utils';

function RegulatorDashboard() {
  const { user } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Audit · {user?.orgName}</h1><p className="text-sm text-muted">Read-only view of every committed transaction. Private invoice data stays inside the supplier/buyer/operator collection.</p></div>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <AuditFeed onSelectInvoice={setSelected} selected={selected} />
          <div className="grid gap-4 md:grid-cols-2"><AnomalyPanel onSelectInvoice={setSelected} /><FrozenPanel /></div>
        </div>
        <Card className="xl:sticky xl:top-20 xl:self-start">
          <CardHeader className="flex-row items-start justify-between">
            <div><CardTitle>Provenance</CardTitle><CardDescription>{selected ? <span className="mono">{shortId(selected, 20)}</span> : 'Select an invoice from the feed'}</CardDescription></div>
            {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Clear</Button>}
          </CardHeader>
          <CardContent className="max-h-[75vh] overflow-y-auto">
            {selected ? <InvoiceDetailBody invoiceId={selected} /> : <EmptyState icon={<ScanSearch className="h-6 w-6" />} title="No invoice selected" description="Click any row with an invoice to see its full ledger history, public hashes and payment trail." className="bg-transparent border-0" />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RegulatorPage() {
  return <RequireRole roles={['REGULATOR']}><RegulatorDashboard /></RequireRole>;
}
