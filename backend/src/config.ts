/** Environment configuration. Loads the repo-root `.env` (optional) and falls back to demo-safe defaults. */
import { config as loadDotenv } from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(BACKEND_DIR, '..');

const envFile = resolve(REPO_ROOT, '.env');
if (existsSync(envFile)) loadDotenv({ path: envFile });

function str(key: string, def: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
}
function int(key: string, def: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
}
function bool(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
}
/** Resolve a path from the repo root unless absolute. */
export function fromRoot(p: string): string { return isAbsolute(p) ? p : resolve(REPO_ROOT, p); }

const ledgerModeRaw = str('LEDGER_MODE', 'auto');
export const config = {
  nodeEnv: str('NODE_ENV', 'development'),
  demoMode: bool('DEMO_MODE', true),
  port: int('PORT', 4000),
  host: str('HOST', '0.0.0.0'),
  backendUrl: str('BACKEND_URL', `http://localhost:${int('PORT', 4000)}`),
  frontendUrl: str('FRONTEND_URL', 'http://localhost:3000'),
  logLevel: str('LOG_LEVEL', 'info'),
  ledgerMode: (['auto', 'fabric', 'mock'].includes(ledgerModeRaw) ? ledgerModeRaw : 'auto') as 'auto' | 'fabric' | 'mock',
  mockLedgerFile: fromRoot(str('MOCK_LEDGER_FILE', '.data/ledger.json')),
  fabric: {
    channel: str('FABRIC_CHANNEL', 'billbridge'),
    chaincode: str('FABRIC_CHAINCODE', 'billbridge'),
    peerEndpoint: process.env['FABRIC_PEER_ENDPOINT'] ?? '',
    peerHostAlias: str('FABRIC_PEER_HOST_ALIAS', 'peer0.org1.example.com'),
    identitiesDir: fromRoot(str('FABRIC_IDENTITIES_DIR', './identities')),
    healthTimeoutMs: int('FABRIC_HEALTH_TIMEOUT_MS', 90000),
    checkpointFile: fromRoot(str('FABRIC_CHECKPOINT_FILE', '.data/fabric-checkpoint.json')),
  },
  databaseUrl: str('DATABASE_URL', 'file:./dev.db'),
  jwt: {
    accessSecret: str('JWT_ACCESS_SECRET', 'change-me-access-secret-32-chars-min'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'change-me-refresh-secret-32-chars-min'),
    accessTtlSeconds: int('JWT_ACCESS_TTL_SECONDS', 15 * 60),
    refreshTtlSeconds: int('JWT_REFRESH_TTL_SECONDS', 7 * 24 * 3600),
  },
  upi: {
    webhookSecret: str('UPI_WEBHOOK_SECRET', 'change-me-upi-webhook-secret'),
    platformVpa: str('UPI_PLATFORM_VPA', 'billbridge@upi'),
    platformName: str('UPI_PLATFORM_NAME', 'BillBridge Escrow'),
    intentTtlSeconds: int('UPI_INTENT_TTL_SECONDS', 600),
    webhookSkewSeconds: int('UPI_WEBHOOK_SKEW_SECONDS', 300),
    npci: {
      baseUrl: process.env['NPCI_SANDBOX_BASE_URL'] ?? '',
      clientId: process.env['NPCI_SANDBOX_CLIENT_ID'] ?? '',
      clientSecret: process.env['NPCI_SANDBOX_CLIENT_SECRET'] ?? '',
    },
  },
  uploadDir: fromRoot(str('UPLOAD_DIR', './backend/uploads')),
  gemini: { apiKey: process.env['GEMINI_API_KEY'] ?? '', model: str('GEMINI_MODEL', 'gemini-2.5-flash'), timeoutMs: int('GEMINI_TIMEOUT_MS', 15000) },
  autoSupplierPayout: bool('AUTO_SUPPLIER_PAYOUT', true),
  statsCacheMs: int('STATS_CACHE_MS', 5000),
};
export type AppConfig = typeof config;

export const demoRoutesEnabled = config.nodeEnv !== 'production' && config.demoMode;

export function ensureDir(p: string): string { mkdirSync(p, { recursive: true }); return p; }
