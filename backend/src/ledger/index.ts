/**
 * Ledger factory: LEDGER_MODE=auto|fabric|mock.
 *  - fabric: must reach the gateway (health with timeout) or startup fails.
 *  - auto:   try Fabric when it is plausibly configured (identities + peer endpoint), else mock immediately.
 *  - mock:   file-persisted MockLedger (Fabric-compatible interface).
 */
import { existsSync, readdirSync } from 'node:fs';
import { LedgerApi, type LedgerClient, type LedgerMode } from '@billbridge/shared';
import { MockLedger } from '@billbridge/shared/ledger';
import { config } from '../config.js';
import { operatorCaller } from './identity.js';

export interface LedgerBundle {
  ledger: LedgerApi;
  ledgerClient: LedgerClient;
  ledgerMode: LedgerMode;
  /** Idempotent chaincode init (mock only; Fabric is initialised at deploy time). */
  init(): Promise<void>;
}

type Logger = { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };

function hasFabricIdentities(dir: string): boolean {
  try { return existsSync(dir) && readdirSync(dir).length > 0; } catch { return false; }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function initPayload(): string {
  return JSON.stringify({ demoMode: config.demoMode, bootstrapOperatorId: operatorCaller().participantId });
}

export function mockBundle(filePath: string | null): LedgerBundle {
  const client = new MockLedger({ filePath, channel: config.fabric.channel, chaincode: config.fabric.chaincode });
  return {
    ledger: new LedgerApi(client),
    ledgerClient: client,
    ledgerMode: 'mock',
    async init() { await client.init(initPayload(), operatorCaller()); },
  };
}

export async function createLedger(log: Logger, mode: 'auto' | 'fabric' | 'mock' = config.ledgerMode): Promise<LedgerBundle> {
  if (mode === 'mock') {
    log.info({ ledgerMode: 'mock', file: config.mockLedgerFile }, 'ledger: MockLedger');
    return mockBundle(config.mockLedgerFile);
  }
  const plausible = config.fabric.peerEndpoint !== '' && hasFabricIdentities(config.fabric.identitiesDir);
  if (mode === 'auto' && !plausible) {
    log.warn({ peerEndpoint: config.fabric.peerEndpoint || '(unset)', identitiesDir: config.fabric.identitiesDir },
      '!!! LEDGER FALLBACK: Fabric/Drunix not configured (no FABRIC_PEER_ENDPOINT or empty identities dir) -> using MockLedger !!!');
    return mockBundle(config.mockLedgerFile);
  }
  const timeoutMs = mode === 'fabric' ? config.fabric.healthTimeoutMs : Math.min(config.fabric.healthTimeoutMs, 15000);
  try {
    const { FabricLedgerClient } = await import('./fabric-ledger.js');
    const client = new FabricLedgerClient({
      peerEndpoint: config.fabric.peerEndpoint, peerHostAlias: config.fabric.peerHostAlias, channel: config.fabric.channel,
      chaincode: config.fabric.chaincode, identitiesDir: config.fabric.identitiesDir, checkpointFile: config.fabric.checkpointFile,
    });
    const health = await withTimeout(client.health(), timeoutMs, 'fabric health');
    if (!health.ok) throw new Error(health.detail ?? 'fabric health not ok');
    log.info({ ledgerMode: 'fabric', health }, 'ledger: Fabric gateway connected');
    return { ledger: new LedgerApi(client), ledgerClient: client, ledgerMode: 'fabric', async init() { /* chaincode Init at deploy */ } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (mode === 'fabric') throw new Error(`LEDGER_MODE=fabric but the gateway is unreachable: ${msg}`);
    log.warn({ err: msg }, '!!! LEDGER FALLBACK: Fabric/Drunix gateway unreachable -> using MockLedger (set LEDGER_MODE=mock to silence) !!!');
    return mockBundle(config.mockLedgerFile);
  }
}
