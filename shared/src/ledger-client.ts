import type { Role } from './enums.js';
import type { EnvelopeEvent } from './events.js';

/** Who is invoking the chaincode. On Fabric this comes from the X.509 cert attributes; on the mock it is explicit. */
export interface CallerIdentity {
  mspId: string;
  role: Role;
  participantId: string;
}

export type LedgerMode = 'mock' | 'fabric' | 'drunix';

export interface TxResult<T> {
  data: T;
  txId: string;
  blockNumber: number;
  timestamp: string;
}

export interface SubmitOptions {
  /** Deterministic tx timestamp (tests / seeding). Runtime default: wall clock. */
  txTimestamp?: string;
}

export interface LedgerHealth {
  ok: boolean;
  mode: LedgerMode;
  blockHeight: number;
  channel: string;
  chaincode: string;
  detail?: string;
}

/**
 * Transport-level contract. Identical for MockLedger and the Fabric/Drunix gateway wrapper.
 * All arguments are STRINGS (Fabric semantics): numbers are decimal strings, objects are JSON strings.
 */
export interface LedgerClient {
  readonly mode: LedgerMode;
  submit(caller: CallerIdentity, fn: string, args: string[], opts?: SubmitOptions): Promise<TxResult<unknown>>;
  evaluate(caller: CallerIdentity, fn: string, args: string[], opts?: SubmitOptions): Promise<unknown>;
  onEvent(handler: (event: EnvelopeEvent) => void): () => void;
  health(): Promise<LedgerHealth>;
  /** Recent envelope events (for Last-Event-ID replay / explorer). */
  recentEvents(limit: number): Promise<EnvelopeEvent[]>;
  /** Wipe all state (demo reset). Fabric implementation re-initialises via chaincode demo function. */
  reset(): Promise<void>;
}

/** Encode a JS value as a chaincode string argument. */
export function encodeArg(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

export function encodeArgs(args: unknown[]): string[] { return args.map(encodeArg); }
