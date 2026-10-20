import type { CallerIdentity } from '../ledger-client.js';
import type { SubEvent } from '../events.js';

/**
 * Minimal chaincode stub abstraction — mirrors the subset of Fabric's ChaincodeStubInterface the
 * contract uses. The Go chaincode uses the real stub; the MockLedger implements this one.
 * Keys are plain strings; "composite keys" are `PREFIX~a~b` strings (same layout as the Go code,
 * which uses CreateCompositeKey with "~"-free components and the standard \u0000 separator internally).
 */
export interface HistoryItem { txId: string; timestamp: string; isDelete: boolean; value: string | null; blockNumber: number; fn: string; actorId: string }

export interface ChaincodeStub {
  getTxId(): string;
  /** ISO timestamp of the tx (deterministic across endorsers). */
  getTxTimestamp(): string;
  getCaller(): CallerIdentity;
  getState(key: string): string | undefined;
  putState(key: string, value: string): void;
  delState(key: string): void;
  /** All keys with the given prefix, sorted ascending. */
  getStateByPrefix(prefix: string): Array<{ key: string; value: string }>;
  getPrivateData(collection: string, key: string): string | undefined;
  putPrivateData(collection: string, key: string, value: string): void;
  getHistoryForKey(key: string): HistoryItem[];
  /** Appends to the single envelope event for this tx. */
  addEvent(event: SubEvent): void;
  getBlockNumber(): number;
}
