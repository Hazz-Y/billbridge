/** Prisma (SQLite) — off-chain data only. Creates/pushes the schema automatically when the DB file is missing. */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { BACKEND_DIR, config } from './config.js';

export type Db = PrismaClient;

/** `file:./dev.db` is relative to backend/prisma (Prisma convention). Returns the absolute file path or null for non-file URLs. */
export function sqliteFileFromUrl(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  const p = url.slice('file:'.length).split('?')[0] ?? '';
  if (p === ':memory:') return null;
  return isAbsolute(p) ? p : resolve(BACKEND_DIR, 'prisma', p);
}

/** Runs `prisma db push --skip-generate` against the given URL (idempotent). */
export function pushSchema(databaseUrl: string, opts: { quiet?: boolean } = {}): void {
  const file = sqliteFileFromUrl(databaseUrl);
  if (file) mkdirSync(dirname(file), { recursive: true });
  const prismaCli = resolve(BACKEND_DIR, '..', 'node_modules', 'prisma', 'build', 'index.js');
  const schema = resolve(BACKEND_DIR, 'prisma', 'schema.prisma');
  const r = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', schema], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: opts.quiet ? 'pipe' : 'inherit',
    shell: false,
  });
  if (r.status !== 0) {
    const out = `${r.stderr?.toString() ?? ''} ${r.stdout?.toString() ?? ''}`;
    throw new Error(`prisma db push failed (${r.status}): ${out}`);
  }
}

export function createDb(databaseUrl = config.databaseUrl, opts: { push?: boolean; quiet?: boolean } = {}): PrismaClient {
  const file = sqliteFileFromUrl(databaseUrl);
  const shouldPush = opts.push ?? (file ? !existsSync(file) : false);
  if (shouldPush) pushSchema(databaseUrl, { quiet: opts.quiet });
  process.env['DATABASE_URL'] = databaseUrl;
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export async function wipeDb(db: PrismaClient): Promise<void> {
  await db.$transaction([
    db.refreshToken.deleteMany(), db.upiReservation.deleteMany(), db.upiTransaction.deleteMany(), db.uploadedFile.deleteMany(),
    db.anomaly.deleteMany(), db.ledgerEvent.deleteMany(), db.scoreHistory.deleteMany(), db.appState.deleteMany(), db.user.deleteMany(),
  ]);
}

export async function getState(db: PrismaClient, key: string): Promise<string | null> {
  const r = await db.appState.findUnique({ where: { key } });
  return r?.value ?? null;
}
export async function setState(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
}
export async function delState(db: PrismaClient, key: string): Promise<void> {
  await db.appState.deleteMany({ where: { key } });
}
