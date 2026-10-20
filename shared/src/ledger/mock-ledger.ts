/**
 * MockLedger — in-process, file-persisted implementation of LedgerClient.
 * Simulates: blocks (one per submitted tx), deterministic txIds sha256(counter|fn|args), per-key history,
 * private data collection with org-level access, single envelope event per tx, and atomic (all-or-nothing) writes.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LedgerError, isLedgerError } from '../errors.js';
import type { EnvelopeEvent, SubEvent } from '../events.js';
import type { CallerIdentity, LedgerClient, LedgerHealth, SubmitOptions, TxResult } from '../ledger-client.js';
import { BillBridgeContract, MUTATING_FUNCTIONS, invokeContract } from './contract.js';
import type { ChaincodeStub, HistoryItem } from './stub.js';

interface PersistedState {
  version: 1;
  state: Record<string, string>;
  privateData: Record<string, Record<string, string>>;
  history: Record<string, HistoryItem[]>;
  blockHeight: number;
  txCounter: number;
  events: EnvelopeEvent[];
}

export interface MockLedgerOptions {
  filePath?: string | null;
  channel?: string;
  chaincode?: string;
  /** Called to get the wall-clock tx timestamp when none is supplied. */
  clock?: () => string;
  maxEvents?: number;
}

class TxStub implements ChaincodeStub {
  readonly writes = new Map<string, string | null>();
  readonly privWrites = new Map<string, Map<string, string>>();
  readonly events: SubEvent[] = [];
  constructor(
    private readonly ledger: MockLedger,
    private readonly txId: string,
    private readonly ts: string,
    private readonly caller: CallerIdentity,
    private readonly blockNumber: number,
  ) {}
  getTxId() { return this.txId; }
  getTxTimestamp() { return this.ts; }
  getCaller() { return this.caller; }
  getBlockNumber() { return this.blockNumber; }
  getState(key: string) {
    if (this.writes.has(key)) { const v = this.writes.get(key); return v === null ? undefined : v; }
    return this.ledger.data.state[key];
  }
  putState(key: string, value: string) { this.writes.set(key, value); }
  delState(key: string) { this.writes.set(key, null); }
  getStateByPrefix(prefix: string) {
    const merged = new Map<string, string>();
    for (const [k, v] of Object.entries(this.ledger.data.state)) if (k.startsWith(prefix)) merged.set(k, v);
    for (const [k, v] of this.writes) { if (!k.startsWith(prefix)) continue; if (v === null) merged.delete(k); else merged.set(k, v); }
    return [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([key, value]) => ({ key, value }));
  }
  getPrivateData(collection: string, key: string) {
    const w = this.privWrites.get(collection)?.get(key);
    if (w !== undefined) return w;
    return this.ledger.data.privateData[collection]?.[key];
  }
  putPrivateData(collection: string, key: string, value: string) {
    if (!this.privWrites.has(collection)) this.privWrites.set(collection, new Map());
    this.privWrites.get(collection)?.set(key, value);
  }
  getHistoryForKey(key: string) { return this.ledger.data.history[key] ?? []; }
  addEvent(event: SubEvent) { this.events.push(event); }
}

export class MockLedger implements LedgerClient {
  readonly mode = 'mock' as const;
  data: PersistedState;
  private readonly emitter = new EventEmitter();
  private readonly filePath: string | null;
  private readonly channel: string;
  private readonly chaincode: string;
  private readonly clock: () => string;
  private readonly maxEvents: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: MockLedgerOptions = {}) {
    this.filePath = opts.filePath ?? null;
    this.channel = opts.channel ?? 'billbridge';
    this.chaincode = opts.chaincode ?? 'billbridge';
    this.clock = opts.clock ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    this.maxEvents = opts.maxEvents ?? 2000;
    this.data = this.load();
  }

  private static empty(): PersistedState { return { version: 1, state: {}, privateData: {}, history: {}, blockHeight: 0, txCounter: 0, events: [] }; }

  private load(): PersistedState {
    if (this.filePath && existsSync(this.filePath)) {
      try { return JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedState; } catch { /* corrupt → fresh */ }
    }
    return MockLedger.empty();
  }
  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.filePath);
  }

  /** Initialise the chaincode (idempotent). */
  async init(configJson: string, caller: CallerIdentity, opts?: SubmitOptions): Promise<TxResult<unknown>> {
    return this.submit(caller, 'InitLedger', [configJson], opts);
  }

  submit(caller: CallerIdentity, fn: string, args: string[], opts: SubmitOptions = {}): Promise<TxResult<unknown>> {
    // serialise submits: Fabric orders txs into blocks; the mock does one tx per block.
    const run = this.queue.then(() => this.submitSync(caller, fn, args, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private submitSync(caller: CallerIdentity, fn: string, args: string[], opts: SubmitOptions): TxResult<unknown> {
    if (!MUTATING_FUNCTIONS.has(fn)) throw new LedgerError('ERR_INVALID_ARGUMENT', `${fn} is not a submit (mutating) function`, { fn });
    const counter = this.data.txCounter + 1;
    const txId = createHash('sha256').update(`${counter}|${fn}|${JSON.stringify(args)}`).digest('hex');
    const ts = opts.txTimestamp ?? this.clock();
    const blockNumber = this.data.blockHeight + 1;
    const stub = new TxStub(this, txId, ts, caller, blockNumber);
    const contract = new BillBridgeContract(stub);
    let result: unknown;
    try {
      result = invokeContract(contract, fn, args);
    } catch (e) {
      if (isLedgerError(e)) throw e;
      throw new LedgerError('ERR_INTERNAL', e instanceof Error ? e.message : String(e), { fn });
    }
    // commit (all-or-nothing)
    const now = new Date().toISOString();
    const committedTs = stub.getState('CLOCK_OFFSET_SECONDS');
    const effectiveTs = committedTs ? new Date((Date.parse(ts) / 1000 + Number(committedTs)) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : ts;
    for (const [k, v] of stub.writes) {
      const isDelete = v === null;
      if (isDelete) delete this.data.state[k]; else this.data.state[k] = v;
      if (k.startsWith('INV~')) {
        (this.data.history[k] ??= []).push({ txId, timestamp: effectiveTs, isDelete, value: v, blockNumber, fn, actorId: caller.participantId });
      }
    }
    for (const [col, m] of stub.privWrites) {
      this.data.privateData[col] ??= {};
      for (const [k, v] of m) (this.data.privateData[col] as Record<string, string>)[k] = v;
    }
    this.data.txCounter = counter;
    this.data.blockHeight = blockNumber;
    const invoiceId = (() => {
      for (const e of stub.events) { const id = e.payload['invoiceId']; if (typeof id === 'string') return id; }
      return undefined;
    })();
    const envelope: EnvelopeEvent = { fn, txId, blockNumber, timestamp: effectiveTs, actorId: caller.participantId, actorRole: caller.role, invoiceId, events: stub.events };
    this.data.events.push(envelope);
    if (this.data.events.length > this.maxEvents) this.data.events.splice(0, this.data.events.length - this.maxEvents);
    this.persist();
    void now;
    queueMicrotask(() => this.emitter.emit('event', envelope));
    return { data: result, txId, blockNumber, timestamp: effectiveTs };
  }

  async evaluate(caller: CallerIdentity, fn: string, args: string[], opts: SubmitOptions = {}): Promise<unknown> {
    if (MUTATING_FUNCTIONS.has(fn)) throw new LedgerError('ERR_INVALID_ARGUMENT', `${fn} is a submit function; use submit()`, { fn });
    const stub = new TxStub(this, 'evaluate', opts.txTimestamp ?? this.clock(), caller, this.data.blockHeight);
    try {
      return invokeContract(new BillBridgeContract(stub), fn, args);
    } catch (e) {
      if (isLedgerError(e)) throw e;
      throw new LedgerError('ERR_INTERNAL', e instanceof Error ? e.message : String(e), { fn });
    }
  }

  onEvent(handler: (event: EnvelopeEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
  async health(): Promise<LedgerHealth> {
    return { ok: true, mode: 'mock', blockHeight: this.data.blockHeight, channel: this.channel, chaincode: this.chaincode, detail: 'MockLedger (Fabric-compatible interface)' };
  }
  async recentEvents(limit: number): Promise<EnvelopeEvent[]> { return this.data.events.slice(-limit); }
  async reset(): Promise<void> {
    await this.queue;
    this.data = MockLedger.empty();
    this.persist();
  }
  get blockHeight(): number { return this.data.blockHeight; }
}
