'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bug, Clock, Database, FlaskConical, Radio, RotateCcw, ShieldAlert, Sparkles, Users, Zap } from 'lucide-react';
import { DEMO_USERS, GUARD_LABEL, ROLES, type AttackResponse, type Role } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, SheetContent, ConfirmDialog } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { useAttack, useDemoState, useInjectMismatch, useMarkDefault, useNetwork, useReset, useSeed, useSimulatePayment, useTimeTravel } from '@/lib/queries';
import { useLedgerEvents } from '@/lib/ledger-events';
import { errorMessage } from '@/lib/api';
import { cn, formatDateTime, formatTime, shortId } from '@/lib/utils';
import { TxBadge, toastTx } from './tx-badge';
import { ledgerModeLabel } from './ledger-badge';

const ATTACKS: Array<{ v: 'SAME_FILE' | 'NEW_NUMBER' | 'CHANGED_AMOUNT'; label: string; hint: string }> = [
  { v: 'SAME_FILE', label: 'Same file', hint: 'Re-upload identical PDF → Guard #3 (file hash)' },
  { v: 'NEW_NUMBER', label: 'New number', hint: 'Same content, new invoice number → Guard #2 (content)' },
  { v: 'CHANGED_AMOUNT', label: 'Changed amount', hint: 'Same identity, altered amount → Guard #1 (identity)' },
];

function Section({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"><Icon className="h-3.5 w-3.5" /> {title}</h4>
      {children}
    </section>
  );
}

export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [attack, setAttack] = useState<AttackResponse | null>(null);
  const { user, switchRole } = useAuth();
  const state = useDemoState();
  const network = useNetwork();
  const { events } = useLedgerEvents();
  const seed = useSeed();
  const reset = useReset();
  const tt = useTimeTravel();
  const sim = useSimulatePayment();
  const atk = useAttack();
  const inject = useInjectMismatch();
  const markDefault = useMarkDefault();
  const [switching, setSwitching] = useState<Role | null>(null);

  const recent = useMemo(() => {
    const fromSse = events.map((e) => ({ txId: e.txId, blockNumber: e.blockNumber, fn: e.fn, timestamp: e.timestamp, actorId: e.actorId }));
    const fromNet = (network.data?.recent ?? []).map((t) => ({ txId: t.txId, blockNumber: t.blockNumber, fn: t.fn, timestamp: t.timestamp, actorId: t.actorId }));
    const seen = new Set<string>();
    return [...fromSse, ...fromNet].filter((t) => (seen.has(t.txId) ? false : (seen.add(t.txId), true))).sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 20);
  }, [events, network.data]);

  const fail = (e: unknown) => toast.error('Demo action failed', { description: errorMessage(e) });
  const last = state.data?.lastCreatedInvoiceId ?? null;

  const doTimeTravel = (body: Parameters<typeof tt.mutateAsync>[0], label: string) =>
    tt.mutateAsync(body).then((r) => toastTx(`Clock advanced: ${label}`, r.tx, `Simulated now ${formatDateTime(r.simulatedNow)}`)).catch(fail);

  const simulateDefault = async () => {
    if (!last) return toast.error('No invoice to default');
    try {
      await tt.mutateAsync({ toInvoiceId: last, plusDays: 91 });
      const r = await markDefault.mutateAsync(last);
      toastTx('Invoice defaulted', r.tx, `Buyer score now ${r.buyerScore.score}`);
    } catch (e) { fail(e); }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-xl shadow-primary/30 hover:bg-primary/90 md:bottom-6 md:right-6"
        aria-label="Open demo panel"
      >
        <FlaskConical className="h-5 w-5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <SheetContent title="Demo panel" description={state.data ? `${ledgerModeLabel(state.data.ledgerMode)} · simulated ${formatDateTime(state.data.simulatedNow)}` : 'Judge controls'}>
          <div className="space-y-6">
            <Section icon={Users} title="Switch role">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ROLES.map((r) => {
                  const du = DEMO_USERS.find((d) => d.role === r);
                  return (
                    <Button key={r} size="sm" variant={user?.role === r ? 'primary' : 'outline'} loading={switching === r}
                      onClick={() => { setSwitching(r); switchRole(r).catch(fail).finally(() => { setSwitching(null); setOpen(false); }); }}>
                      {r}{du ? '' : ''}
                    </Button>
                  );
                })}
              </div>
              {user && <p className="mono text-[11px] text-muted">now: {user.name} · {user.role} · {user.participantId} · {user.mspId}</p>}
            </Section>

            <Section icon={Clock} title="Time travel">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!last} loading={tt.isPending} onClick={() => doTimeTravel({ toInvoiceId: last ?? undefined, plusDays: 1 }, 'due date + 1 day')}>Advance to due date (+1 day)</Button>
                <Button size="sm" variant="secondary" loading={tt.isPending} onClick={() => doTimeTravel({ days: 8 }, '+8 days')}>+8 days</Button>
                <Button size="sm" variant="secondary" loading={tt.isPending} onClick={() => doTimeTravel({ days: 91 }, '+91 days')}>+91 days</Button>
              </div>
              <p className="mono text-[11px] text-muted">simulated now: {state.data ? formatDateTime(state.data.simulatedNow) : '—'} (offset {state.data?.offsetSeconds ?? 0}s)</p>
            </Section>

            <Section icon={Zap} title="Quick actions">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={seed.isPending} onClick={() => seed.mutateAsync().then((r) => toast.success(`Seeded ${r.users} users, ${r.invoices} invoices in ${r.durationMs} ms`)).catch(fail)}><Database className="h-4 w-4" /> Seed</Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" /> Reset</Button>
                <Button size="sm" variant="outline" loading={inject.isPending} onClick={() => inject.mutateAsync().then((r) => toast.warning('Mismatch injected', { description: `${r.upiRef}: ${r.reason}` })).catch(fail)}><Bug className="h-4 w-4" /> Inject mismatch</Button>
                <Button size="sm" variant="outline" disabled={!last} loading={markDefault.isPending} onClick={simulateDefault}>Simulate default (+91d)</Button>
              </div>
              {state.data && state.data.pendingUpiRefs.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted">Pending UPI requests</div>
                  {state.data.pendingUpiRefs.map((ref) => (
                    <div key={ref} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1">
                      <span className="mono truncate text-xs">{ref}</span>
                      <Button size="sm" variant="success" loading={sim.isPending} onClick={() => sim.mutateAsync({ upiRef: ref }).then((r) => toastTx(`Payment ${r.status}`, r.ledgerTxId ? { txId: r.ledgerTxId } : null, r.message)).catch(fail)}>Simulate payment</Button>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted">No pending UPI requests.</p>}
            </Section>

            <Section icon={ShieldAlert} title="Attack: double financing">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ATTACKS.map((a) => (
                  <Button key={a.v} size="sm" variant="outline" className="border-danger/50 text-danger hover:bg-danger/10" title={a.hint} loading={atk.isPending && atk.variables === a.v}
                    onClick={() => atk.mutateAsync(a.v).then(setAttack).catch(fail)}>
                    {a.label}
                  </Button>
                ))}
              </div>
              {attack && (
                <div className={cn('space-y-1 rounded-xl border p-3 text-sm', attack.rejected ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10')}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{attack.variant}</span>
                    <Badge tone={attack.rejected ? 'success' : 'danger'}>{attack.rejected ? 'Rejected ✓' : 'NOT rejected'}</Badge>
                  </div>
                  <div className="text-xs text-muted">{attack.message}</div>
                  {attack.guard && <div className="text-xs">{GUARD_LABEL[attack.guard] ?? attack.guard}</div>}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {attack.errorCode && <span className="mono text-danger">{attack.errorCode}</span>}
                    {attack.anomalyTxId && <TxBadge txId={attack.anomalyTxId} />}
                    {attack.targetInvoiceId && <span className="mono text-muted">target {shortId(attack.targetInvoiceId)}</span>}
                  </div>
                </div>
              )}
            </Section>

            <Section icon={Radio} title="Network explorer">
              <div className="flex items-center gap-2 text-xs">
                <Badge tone={network.data?.healthy ? 'success' : 'warning'}>{network.data ? ledgerModeLabel(network.data.ledgerMode) : 'connecting…'}</Badge>
                {network.data && <span className="mono text-muted">{network.data.channel}/{network.data.chaincode} · block #{network.data.blockHeight}</span>}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-elev text-left text-muted"><tr><th className="px-2 py-1">Block</th><th className="px-2 py-1">Fn</th><th className="px-2 py-1">Tx</th><th className="px-2 py-1">Time</th></tr></thead>
                  <tbody>
                    {recent.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-center text-muted">No transactions yet</td></tr>}
                    {recent.map((t) => (
                      <tr key={t.txId} className="border-t border-border">
                        <td className="mono px-2 py-1 text-primary">#{t.blockNumber}</td>
                        <td className="px-2 py-1">{t.fn}</td>
                        <td className="px-2 py-1"><TxBadge txId={t.txId} size="xs" /></td>
                        <td className="mono px-2 py-1 text-muted">{formatTime(t.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
            <p className="flex items-center gap-1 text-[11px] text-muted"><Sparkles className="h-3 w-3" /> Demo routes exist only when the backend runs with DEMO_MODE=true.</p>
          </div>
        </SheetContent>
      </Dialog>
      <ConfirmDialog open={confirmReset} onOpenChange={setConfirmReset} title="Reset the demo ledger?" description="All invoices, holdings and anomalies will be wiped and re-seeded." confirmLabel="Reset" danger loading={reset.isPending}
        onConfirm={() => reset.mutateAsync().then((r) => { toast.success(`Reset done: ${r.invoices} invoices re-seeded`); setConfirmReset(false); }).catch(fail)} />
    </>
  );
}
