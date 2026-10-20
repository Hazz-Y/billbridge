import { Building2, Factory, Landmark, ScanSearch, TrendingUp } from 'lucide-react';
import type { Role } from '@billbridge/shared';

export const ROLE_META: Record<Role, { icon: typeof Factory; title: string; blurb: string }> = {
  MSME: { icon: Factory, title: 'MSME supplier', blurb: 'Upload invoices, get paid in minutes instead of months.' },
  BUYER: { icon: Building2, title: 'Corporate buyer', blurb: 'Accept invoices and repay via UPI at maturity.' },
  INVESTOR: { icon: TrendingUp, title: 'Investor', blurb: 'Fund tokenized invoices in ₹1,000 units.' },
  OPERATOR: { icon: Landmark, title: 'Platform operator', blurb: 'List invoices, run KYC, settle payouts.' },
  REGULATOR: { icon: ScanSearch, title: 'Regulator', blurb: 'Read-only audit of every ledger transaction.' },
};
