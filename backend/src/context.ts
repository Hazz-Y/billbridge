import type { LedgerApi, LedgerClient, LedgerMode } from '@billbridge/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import type { EventPipeline } from './events/pipeline.js';
import type { LedgerBundle } from './ledger/index.js';
import type { UpiProvider } from './upi/provider.js';

export interface AppContext {
  config: AppConfig;
  db: Db;
  ledger: LedgerApi;
  ledgerClient: LedgerClient;
  ledgerMode: LedgerMode;
  ledgerBundle: LedgerBundle;
  upi: UpiProvider;
  events: EventPipeline;
  log: FastifyBaseLogger;
  /** Process-local timers (expiry sweeps) so tests can stop them. */
  timers: NodeJS.Timeout[];
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
  }
}
