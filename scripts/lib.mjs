// Shared helpers for the orchestration scripts (cross-platform, no deps).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, '.data');
export const LOG_DIR = join(DATA_DIR, 'logs');
export const PID_FILE = join(DATA_DIR, 'pids.json');
export const IS_WIN = process.platform === 'win32';

export function loadEnv() {
  const env = { ...process.env };
  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] === undefined) env[m[1]] = v;
    }
  }
  env.NODE_ENV ??= 'development';
  env.DEMO_MODE ??= 'true';
  env.LEDGER_MODE ??= 'auto';
  env.PORT ??= '4000';
  env.BACKEND_URL ??= `http://localhost:${env.PORT}`;
  env.FRONTEND_PORT ??= '3000';
  env.FRONTEND_URL ??= `http://localhost:${env.FRONTEND_PORT}`;
  env.NEXT_PUBLIC_API_URL ??= env.BACKEND_URL;
  env.NEXT_TELEMETRY_DISABLED = '1';
  // keep caches off a possibly-full system drive
  const tmp = join(ROOT, '.cache', 'tmp');
  mkdirSync(tmp, { recursive: true });
  env.TMPDIR ??= tmp; env.TMP ??= tmp; env.TEMP ??= tmp;
  env.GOMODCACHE ??= join(ROOT, '.cache', 'go', 'mod');
  env.GOCACHE ??= join(ROOT, '.cache', 'go', 'build');
  env.GOTMPDIR ??= tmp;
  env.GOFLAGS ??= '-mod=mod';
  const goBin = IS_WIN ? 'C:\\Program Files\\Go\\bin' : '/usr/local/go/bin';
  if (existsSync(goBin) && !(env.PATH ?? '').includes(goBin)) env.PATH = `${env.PATH}${IS_WIN ? ';' : ':'}${goBin}`;
  return env;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: IS_WIN, env: opts.env ?? loadEnv(), ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n✖ ${cmd} ${args.join(' ')} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.status ?? 1;
}

export function has(cmd, args = ['--version'], env = loadEnv()) {
  const r = spawnSync(cmd, args, { stdio: 'ignore', shell: IS_WIN, env });
  return r.status === 0;
}

export function startDetached(name, cmd, args, env) {
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(cmd, args, { cwd: ROOT, env, shell: IS_WIN, detached: !IS_WIN, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  return child.pid;
}

export function readPids() { try { return JSON.parse(readFileSync(PID_FILE, 'utf8')); } catch { return {}; } }
export function writePids(p) { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(PID_FILE, JSON.stringify(p, null, 2)); }

export function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch { /* already gone */ }
}

export async function waitFor(url, { timeoutMs = 120000, label = url, intervalMs = 1000 } = {}) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return await r.json().catch(() => ({}));
      lastErr = `HTTP ${r.status}`;
    } catch (e) { lastErr = e?.message ?? String(e); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${label} (${lastErr})`);
}

export async function isUp(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}

export function openBrowser(url) {
  const env = loadEnv();
  if (IS_WIN) spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore', env }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore', env }).unref();
}

export const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
