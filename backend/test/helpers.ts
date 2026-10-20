/** Test harness: fresh MockLedger (in-memory) + temp SQLite DB + Fastify app (inject). */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DEMO_PASSWORD, type TokenResponse, type UpiWebhookPayload } from '@billbridge/shared';
import { buildApp } from '../src/app.js';
import { REPO_ROOT, config } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { createDb } from '../src/db.js';
import { mockBundle } from '../src/ledger/index.js';
import { signWebhook } from '../src/upi/provider.js';

export interface Harness { app: FastifyInstance; ctx: AppContext; close(): Promise<void> }

export async function startHarness(name: string): Promise<Harness> {
  const dir = resolve(REPO_ROOT, '.cache', 'test-db');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}-${process.pid}-${Date.now()}.db`);
  rmSync(file, { force: true });
  const db = createDb(`file:${file.replace(/\\/g, '/')}`, { push: true, quiet: true });
  const testConfig = { ...config, backendUrl: 'http://127.0.0.1:1', uploadDir: resolve(dir, 'uploads'), statsCacheMs: 0 };
  const { app, ctx } = await buildApp({ ledger: mockBundle(null), db, config: testConfig, logger: false, demoRoutes: true });
  await app.ready();
  return { app, ctx, close: async () => { await app.close(); rmSync(file, { force: true }); } };
}

export async function login(app: FastifyInstance, email: string): Promise<TokenResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEMO_PASSWORD } });
  if (r.statusCode !== 200) throw new Error(`login ${email} failed: ${r.body}`);
  return r.json() as TokenResponse;
}

export function auth(t: TokenResponse): Record<string, string> { return { authorization: `Bearer ${t.accessToken}` }; }

export function signedWebhook(payload: UpiWebhookPayload, secret = config.upi.webhookSecret, ts = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  return { body, headers: { 'content-type': 'application/json', 'x-upi-signature': signWebhook(body, secret), 'x-upi-timestamp': String(ts) } };
}
