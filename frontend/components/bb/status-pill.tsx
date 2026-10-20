import type { InvoiceStatus, UpiStatus } from '@billbridge/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';

const STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  DRAFT: 'muted', BUYER_ACCEPTED: 'primary', LISTED: 'primary', PARTIALLY_FUNDED: 'warning', FULLY_FUNDED: 'success',
  SUPPLIER_PAID: 'success', SETTLED: 'success', LATE: 'warning', DEFAULTED: 'danger', CANCELLED: 'danger',
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft', BUYER_ACCEPTED: 'Accepted', LISTED: 'Listed', PARTIALLY_FUNDED: 'Partially funded', FULLY_FUNDED: 'Fully funded',
  SUPPLIER_PAID: 'Supplier paid', SETTLED: 'Settled', LATE: 'Late', DEFAULTED: 'Defaulted', CANCELLED: 'Cancelled',
};

export function statusLabel(s: InvoiceStatus): string { return STATUS_LABEL[s]; }

export function StatusPill({ status, className }: { status: InvoiceStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const UPI_TONE: Record<UpiStatus, BadgeTone> = {
  INITIATED: 'muted', PROCESSING: 'warning', SUCCESS: 'success', FAILED: 'danger', EXPIRED: 'muted',
  FAILED_LEDGER_REJECTED: 'danger', REFUND_REQUIRED: 'warning', REFUNDED: 'neutral',
};

export function UpiStatusPill({ status }: { status: UpiStatus }) {
  return <Badge tone={UPI_TONE[status]}>{status.replaceAll('_', ' ')}</Badge>;
}

export function KycPill({ status }: { status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' }) {
  const tone: BadgeTone = status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'warning' : 'danger';
  return <Badge tone={tone}>KYC {status.toLowerCase()}</Badge>;
}
