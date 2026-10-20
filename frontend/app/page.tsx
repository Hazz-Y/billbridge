'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Coins, FileCheck2, Landmark, Lock, Send, ShieldCheck, Zap } from 'lucide-react';
import { formatBps, formatINRCompact } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useStats } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { LedgerBadge, ledgerModeLabel } from '@/components/bb/ledger-badge';
import { ROLE_HOME } from '@/lib/utils';
import { ROLE_META } from '@/components/bb/role-meta';

function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / ms)); // rAF timestamps can precede `start`
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = Math.max(0, Math.round(begin + (target - begin) * eased));
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Stat({ label, value, render }: { label: string; value: number; render: (n: number) => string }) {
  const n = useCountUp(value);
  return (
    <Card><CardContent className="p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mono mt-1 text-2xl font-bold">{render(n)}</div>
    </CardContent></Card>
  );
}

const FLOW = [
  { icon: FileCheck2, label: 'MSME uploads invoice' },
  { icon: Coins, label: 'Tokenized on ledger' },
  { icon: Landmark, label: 'Investors fund via UPI' },
  { icon: Send, label: 'Supplier paid in minutes' },
];

const STEPS = [
  { title: 'Upload & extract', body: 'Drop a GST invoice PDF. Fields are extracted with confidence scores; totals are checked with integer math.' },
  { title: 'Buyer accepts', body: 'The corporate buyer confirms the invoice is genuine. Three on-chain guards block any double-financing attempt.' },
  { title: 'Investors fund in units', body: 'The operator lists it at an annualized discount. Investors buy ₹1,000 units through a UPI intent — no wallets, no crypto.' },
  { title: 'Settle & distribute', body: 'At maturity the buyer repays via UPI; the ledger waterfall pays investors and any residual to the supplier, and the buyer score updates.' },
];

export default function LandingPage() {
  const stats = useStats(5000);
  const { user } = useAuth();
  const s = stats.data;
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 md:grid-cols-2">
        <div className="space-y-6">
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            Invoices paid in <span className="text-primary">minutes</span>, not months.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="max-w-prose text-lg text-muted">
            BillBridge tokenizes approved MSME invoices on a permissioned ledger and settles every leg through UPI. Investors earn short-tenor yield; suppliers unlock working capital; regulators see every transaction.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-wrap gap-3">
            <Link href={user ? (ROLE_HOME[user.role] ?? '/') : '/login'}><Button size="lg">{user ? 'Open my dashboard' : 'Try the demo'} <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/register"><Button size="lg" variant="outline">Register</Button></Link>
          </motion.div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <LedgerBadge />
            <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Private data stays in per-org collections</span>
          </div>
        </div>
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {FLOW.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div key={f.label} className="flex flex-col items-center gap-2 text-center" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.25, type: 'spring' }}>
                  <motion.div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary" animate={{ boxShadow: ['0 0 0 0 rgba(59,130,246,0)', '0 0 0 10px rgba(59,130,246,0.12)', '0 0 0 0 rgba(59,130,246,0)'] }} transition={{ repeat: Infinity, duration: 2.4, delay: i * 0.6 }}>
                    <Icon className="h-6 w-6" />
                  </motion.div>
                  <span className="text-xs">{f.label}</span>
                </motion.div>
              );
            })}
          </div>
          <motion.div className="mt-6 h-1 rounded-full bg-gradient-to-r from-primary via-success to-primary" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.6, duration: 1.4 }} style={{ transformOrigin: 'left' }} />
          <p className="mt-3 text-center text-xs text-muted">Every arrow above is a ledger transaction with a txId you can inspect.</p>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total funded" value={s?.totalFundedPaise ?? 0} render={(n) => formatINRCompact(n)} />
        <Stat label="Active invoices" value={s?.activeInvoices ?? 0} render={(n) => String(n)} />
        <Stat label="Avg annualized yield" value={s?.avgYieldBps ?? 0} render={(n) => formatBps(n)} />
        <Stat label="Settled" value={s?.settledInvoices ?? 0} render={(n) => String(n)} />
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">The problem</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="p-5 text-sm text-muted"><strong className="block text-fg">Long payment cycles.</strong> Reported estimates put typical corporate-to-MSME payment terms at 60–90 days, locking up working capital that small suppliers need today.</CardContent></Card>
          <Card><CardContent className="p-5 text-sm text-muted"><strong className="block text-fg">Double financing risk.</strong> The same invoice can be pledged to several lenders. A shared ledger with identity, content and file-hash guards makes that impossible by construction.</CardContent></Card>
          <Card><CardContent className="p-5 text-sm text-muted"><strong className="block text-fg">Settlement friction.</strong> Funding and repayment rails are slow and opaque. UPI intents with ledger-reconciled webhooks close the loop in minutes.</CardContent></Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((st, i) => (
            <li key={st.title} className="glass rounded-2xl p-5">
              <div className="mono mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">{i + 1}</div>
              <div className="font-medium">{st.title}</div>
              <p className="mt-1 text-sm text-muted">{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Pick a seat</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(ROLE_META) as Array<keyof typeof ROLE_META>).map((r) => {
            const m = ROLE_META[r];
            const Icon = m.icon;
            return (
              <Link key={r} href={user?.role === r ? (ROLE_HOME[r] ?? '/') : `/login?next=${ROLE_HOME[r]}`} className="glass flex flex-col gap-2 rounded-2xl p-4 transition-colors hover:bg-fg/5">
                <Icon className="h-5 w-5 text-primary" />
                <span className="font-medium">{m.title}</span>
                <span className="text-xs text-muted">{m.blurb}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="glass flex flex-col items-start gap-3 rounded-2xl p-6 text-sm text-muted md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-success" /><span>{ledgerModeLabel(s?.ledgerMode)} — same chaincode interface, same guards; swap the adapter for Fabric/Drunix without changing the UI.</span></div>
        <div className="flex items-center gap-2"><Zap className="h-4 w-4 text-warning" /><span>Block height {s?.blockHeight ?? '—'}</span></div>
      </section>
    </div>
  );
}
