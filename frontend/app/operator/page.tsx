'use client';
import { useState } from 'react';
import { Activity, GitCompareArrows, ListChecks, Scale, ShieldCheck } from 'lucide-react';
import { RequireRole, useAuth } from '@/lib/auth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InvoiceDrawer } from '@/components/bb/invoice-drawer';
import { ListingTab } from '@/components/operator/listing-tab';
import { KycTab } from '@/components/operator/kyc-tab';
import { SettlementTab } from '@/components/operator/settlement-tab';
import { HealthTab, ReconciliationTab } from '@/components/operator/recon-tab';

function OperatorDashboard() {
  const { user } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Operations · {user?.orgName}</h1><p className="text-sm text-muted">Price listings, run KYC, release payouts and reconcile UPI against the ledger.</p></div>
      <Tabs defaultValue="listing">
        <TabsList>
          <TabsTrigger value="listing"><ListChecks className="h-4 w-4" /> Listing</TabsTrigger>
          <TabsTrigger value="kyc"><ShieldCheck className="h-4 w-4" /> KYC</TabsTrigger>
          <TabsTrigger value="settlement"><Scale className="h-4 w-4" /> Settlement</TabsTrigger>
          <TabsTrigger value="recon"><GitCompareArrows className="h-4 w-4" /> Reconciliation</TabsTrigger>
          <TabsTrigger value="health"><Activity className="h-4 w-4" /> Health</TabsTrigger>
        </TabsList>
        <TabsContent value="listing"><ListingTab onOpen={setOpen} /></TabsContent>
        <TabsContent value="kyc"><KycTab /></TabsContent>
        <TabsContent value="settlement"><SettlementTab onOpen={setOpen} /></TabsContent>
        <TabsContent value="recon"><ReconciliationTab /></TabsContent>
        <TabsContent value="health"><HealthTab /></TabsContent>
      </Tabs>
      <InvoiceDrawer invoiceId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export default function OperatorPage() {
  return <RequireRole roles={['OPERATOR']}><OperatorDashboard /></RequireRole>;
}
