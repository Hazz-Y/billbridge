'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { SseEventSchema, type SseEvent } from '@billbridge/shared';
import { sseUrl } from './api';
import { useInvalidateLedger } from './queries';
import { useAuth } from './auth';
import { isMockMode, shortId } from './utils';
import { EVENTS } from './mock/fixtures';

const RING = 200;

interface LedgerEventsValue {
  events: SseEvent[];
  connected: boolean;
  lastEventId: string | null;
}

const Ctx = createContext<LedgerEventsValue>({ events: [], connected: false, lastEventId: null });

function describe(e: SseEvent): string {
  const sub = e.events[0];
  const p = sub?.payload ?? {};
  const units = typeof p.units === 'number' ? ` · ${p.units} units` : '';
  return `Block #${e.blockNumber} · ${e.fn}${units}`;
}

/** ONE EventSource for the whole app; pushes events into a ring buffer and invalidates queries. */
export function LedgerEventsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const invalidate = useInvalidateLedger();
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const lastId = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const push = useCallback((e: SseEvent, quiet = false) => {
    if (seen.current.has(e.txId)) return;
    seen.current.add(e.txId);
    setEvents((prev) => [e, ...prev].slice(0, RING));
    invalidate(e.invoiceId);
    if (!quiet && e.fn !== 'AdvanceClock') {
      toast(describe(e), { description: `tx ${shortId(e.txId, 12)} · ${e.actorId}`, duration: 3500 });
    }
  }, [invalidate]);

  useEffect(() => {
    if (!user) return;
    if (isMockMode()) {
      // Synthetic liveliness without a backend: one event every 20 s.
      let i = 0;
      const t = setInterval(() => {
        const base = EVENTS[i % EVENTS.length];
        if (!base) return;
        i += 1;
        push({ ...base, seq: 1000 + i, blockNumber: 100 + i, txId: `${base.txId.slice(0, 48)}${(100000 + i).toString(16).padStart(16, '0')}`, timestamp: new Date().toISOString() });
      }, 20_000);
      setConnected(true);
      return () => { clearInterval(t); setConnected(false); };
    }
    let es: EventSource | null = null;
    let retry = 1000;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      if (closed) return;
      es = new EventSource(sseUrl(lastId.current));
      es.onopen = () => { setConnected(true); retry = 1000; };
      es.addEventListener('ledger', (ev: MessageEvent<string>) => {
        lastId.current = ev.lastEventId || lastId.current;
        try {
          const parsed = SseEventSchema.safeParse(JSON.parse(ev.data));
          if (parsed.success) push(parsed.data);
        } catch { /* ignore malformed frame */ }
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
      setConnected(false);
    };
  }, [user, push]);

  const value = useMemo(() => ({ events, connected, lastEventId: lastId.current }), [events, connected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedgerEvents(): LedgerEventsValue {
  return useContext(Ctx);
}
