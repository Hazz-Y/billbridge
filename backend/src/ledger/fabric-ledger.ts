/**
 * FabricLedgerClient — LedgerClient over @hyperledger/fabric-gateway (Fabric 2.5 / Drunix compatible).
 * Identity layout: `<identitiesDir>/<participantId>/cert.pem`, `key.pem`, optional `mspid` (defaults to the caller's mspId)
 * and an optional `<identitiesDir>/tls-ca.pem` for the peer TLS root (plaintext gRPC when absent).
 * Only exercised when LEDGER_MODE=fabric|auto with a reachable gateway.
 */
import * as grpc from '@grpc/grpc-js';
import {
  checkpointers, connect, signers, type ChaincodeEvent, type CloseableAsyncIterable, type Contract, type Gateway, type Network,
} from '@hyperledger/fabric-gateway';
import { createPrivateKey } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  EnvelopeEventSchema, LedgerError, parseLedgerError,
  type CallerIdentity, type EnvelopeEvent, type LedgerClient, type LedgerHealth, type SubmitOptions, type TxResult,
} from '@billbridge/shared';

export interface FabricOptions {
  peerEndpoint: string;
  peerHostAlias: string;
  channel: string;
  chaincode: string;
  identitiesDir: string;
  checkpointFile: string;
  maxRecentEvents?: number;
}

const MVCC_READ_CONFLICT = 11;
const utf8 = new TextDecoder();

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export class FabricLedgerClient implements LedgerClient {
  readonly mode = 'fabric' as const;
  private readonly emitter = new EventEmitter();
  private readonly gateways = new Map<string, Gateway>();
  private client: grpc.Client | null = null;
  private readonly recent: EnvelopeEvent[] = [];
  private eventStream: CloseableAsyncIterable<ChaincodeEvent> | null = null;
  private listening = false;

  constructor(private readonly opts: FabricOptions) {}

  // ── connection plumbing ──
  private grpcClient(): grpc.Client {
    if (this.client) return this.client;
    const tlsPath = join(this.opts.identitiesDir, 'tls-ca.pem');
    const creds = existsSync(tlsPath) ? grpc.credentials.createSsl(readFileSync(tlsPath)) : grpc.credentials.createInsecure();
    this.client = new grpc.Client(this.opts.peerEndpoint, creds, {
      'grpc.ssl_target_name_override': this.opts.peerHostAlias,
      'grpc.default_authority': this.opts.peerHostAlias,
    });
    return this.client;
  }

  private gatewayFor(caller: CallerIdentity): Gateway {
    const existing = this.gateways.get(caller.participantId);
    if (existing) return existing;
    const dir = join(this.opts.identitiesDir, caller.participantId);
    const certPath = join(dir, 'cert.pem');
    const keyPath = join(dir, 'key.pem');
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      throw new LedgerError('ERR_LEDGER_UNAVAILABLE', `no Fabric identity for ${caller.participantId} under ${dir}`, { participantId: caller.participantId });
    }
    const mspPath = join(dir, 'mspid');
    const mspId = existsSync(mspPath) ? readFileSync(mspPath, 'utf8').trim() : caller.mspId;
    const gateway = connect({
      client: this.grpcClient(),
      identity: { mspId, credentials: readFileSync(certPath) },
      signer: signers.newPrivateKeySigner(createPrivateKey(readFileSync(keyPath))),
      evaluateOptions: () => ({ deadline: Date.now() + 15000 }),
      endorseOptions: () => ({ deadline: Date.now() + 30000 }),
      submitOptions: () => ({ deadline: Date.now() + 15000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    this.gateways.set(caller.participantId, gateway);
    return gateway;
  }

  private network(caller: CallerIdentity): Network { return this.gatewayFor(caller).getNetwork(this.opts.channel); }
  private contract(caller: CallerIdentity): Contract { return this.network(caller).getContract(this.opts.chaincode); }

  private toLedgerError(e: unknown, fn: string): LedgerError {
    if (e instanceof LedgerError) return e;
    const err = e as { message?: string; details?: Array<{ message?: string }> };
    const candidates = [err.message ?? '', ...(err.details ?? []).map((d) => d.message ?? '')];
    for (const c of candidates) { const parsed = parseLedgerError(c); if (parsed) return parsed; }
    return new LedgerError('ERR_LEDGER_UNAVAILABLE', `fabric ${fn} failed: ${err.message ?? String(e)}`, { fn });
  }

  // ── LedgerClient ──
  async submit(caller: CallerIdentity, fn: string, args: string[], _opts?: SubmitOptions): Promise<TxResult<unknown>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const proposal = this.contract(caller).newProposal(fn, { arguments: args });
        const tx = await proposal.endorse();
        const commit = await tx.submit();
        const status = await commit.getStatus();
        if (!status.successful) {
          if (status.code === MVCC_READ_CONFLICT) { lastErr = new Error('MVCC_READ_CONFLICT'); await sleep(100 + Math.random() * 300 * (attempt + 1)); continue; }
          throw new LedgerError('ERR_LEDGER_UNAVAILABLE', `transaction ${status.transactionId} failed with status ${status.code}`, { fn, code: status.code });
        }
        const raw = utf8.decode(tx.getResult());
        const data: unknown = raw ? JSON.parse(raw) : null;
        return { data, txId: status.transactionId, blockNumber: Number(status.blockNumber), timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
      } catch (e) {
        if (e instanceof LedgerError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (/MVCC_READ_CONFLICT/.test(msg) && attempt < 2) { lastErr = e; await sleep(100 + Math.random() * 300 * (attempt + 1)); continue; }
        throw this.toLedgerError(e, fn);
      }
    }
    throw this.toLedgerError(lastErr, fn);
  }

  async evaluate(caller: CallerIdentity, fn: string, args: string[]): Promise<unknown> {
    try {
      const raw = utf8.decode(await this.contract(caller).evaluateTransaction(fn, ...args));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { throw this.toLedgerError(e, fn); }
  }

  onEvent(handler: (event: EnvelopeEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  /** Starts the chaincode event listener (checkpointed). Idempotent. */
  async startEvents(caller: CallerIdentity): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    mkdirSync(dirname(this.opts.checkpointFile), { recursive: true });
    const checkpointer = await checkpointers.file(this.opts.checkpointFile);
    const run = async () => {
      while (this.listening) {
        try {
          this.eventStream = await this.network(caller).getChaincodeEvents(this.opts.chaincode, { checkpoint: checkpointer });
          for await (const ev of this.eventStream) {
            const parsed = EnvelopeEventSchema.safeParse(JSON.parse(utf8.decode(ev.payload)));
            if (parsed.success) {
              this.recent.push(parsed.data);
              if (this.recent.length > (this.opts.maxRecentEvents ?? 2000)) this.recent.shift();
              this.emitter.emit('event', parsed.data);
            }
            await checkpointer.checkpointChaincodeEvent(ev);
          }
        } catch {
          if (!this.listening) return;
          await sleep(2000);
        }
      }
    };
    void run();
  }

  async stopEvents(): Promise<void> { this.listening = false; this.eventStream?.close(); }

  async health(): Promise<LedgerHealth> {
    const base = { mode: 'fabric' as const, channel: this.opts.channel, chaincode: this.opts.chaincode };
    try {
      const anyIdentity = this.firstIdentity();
      if (!anyIdentity) return { ok: false, blockHeight: 0, ...base, detail: 'no identities found' };
      const raw = await this.evaluate(anyIdentity, 'GetClock', []);
      const blockHeight = this.recent.length ? (this.recent[this.recent.length - 1]?.blockNumber ?? 0) : 0;
      return { ok: true, blockHeight, ...base, detail: `GetClock ok: ${JSON.stringify(raw)}` };
    } catch (e) {
      return { ok: false, blockHeight: 0, ...base, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  private firstIdentity(): CallerIdentity | null {
    const opDir = join(this.opts.identitiesDir, 'operator1');
    if (existsSync(join(opDir, 'cert.pem'))) return { mspId: 'Org1MSP', role: 'OPERATOR', participantId: 'operator1' };
    return null;
  }

  async recentEvents(limit: number): Promise<EnvelopeEvent[]> { return this.recent.slice(-limit); }

  async reset(): Promise<void> {
    throw new LedgerError('ERR_DEMO_MODE_DISABLED', 'reset is not supported on a Fabric ledger; redeploy the chaincode to reset state');
  }

  async close(): Promise<void> {
    await this.stopEvents();
    for (const g of this.gateways.values()) g.close();
    this.gateways.clear();
    this.client?.close();
    this.client = null;
  }
}
