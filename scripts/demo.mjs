// make demo — the one command. Idempotent: re-running attaches to already-running services.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, c, isUp, loadEnv, openBrowser, readPids, run, startDetached, waitFor, writePids } from './lib.mjs';

const args = new Set(process.argv.slice(2));
// mirrors shared/src/demo.ts (kept inline: plain Node cannot import TS without flags)
const DEMO_PASSWORD = 'Demo@1234';
const DEMO_USERS = [
  { role: 'OPERATOR', email: 'operator@demo.in', name: 'BillBridge Operations', participantId: 'operator1' },
  { role: 'REGULATOR', email: 'regulator@demo.in', name: 'Sandbox Regulator', participantId: 'regulator1' },
  { role: 'MSME', email: 'msme1@demo.in', name: 'Sharma Precision Components', participantId: 'msme1' },
  { role: 'BUYER', email: 'buyer1@demo.in', name: 'Aurora Motors Ltd', participantId: 'buyer1' },
  { role: 'INVESTOR', email: 'investor1@demo.in', name: 'Priya Nair', participantId: 'investor1' },
  { role: 'INVESTOR', email: 'investor4@demo.in', name: 'Rohan Das', participantId: 'investor4' },
  { role: 'INVESTOR', email: 'investor5@demo.in', name: 'Ananya Rao', participantId: 'investor5' },
];
const env = loadEnv();
const t0 = Date.now();
console.log(c.bold('\n▶ BillBridge demo'));
console.log(c.dim(`  root ${ROOT}\n  LEDGER_MODE=${env.LEDGER_MODE}  DEMO_MODE=${env.DEMO_MODE}  backend ${env.BACKEND_URL}  frontend ${env.FRONTEND_URL}`));

// 1. setup if deps are missing
const depsMissing = !existsSync(join(ROOT, 'node_modules', 'fastify')) || !existsSync(join(ROOT, 'node_modules', 'next'))
  || !existsSync(join(ROOT, 'samples', 'invoice-aurora-001.pdf'));
if (depsMissing || args.has('--setup')) run(process.execPath, [join(ROOT, 'scripts', 'setup.mjs')], { env });

// 2/3. start ledger (inside the backend: LEDGER_MODE=auto → Fabric health ≤90 s, else mock) + backend + frontend
const pids = readPids();
const backendUp = await isUp(`${env.BACKEND_URL}/health`);
if (!backendUp) {
  console.log('  starting backend…');
  pids.backend = startDetached('backend', 'npm', ['run', 'start', '--workspace', 'backend'], env);
} else console.log('  backend already running ✓');

const frontendUp = await isUp(env.FRONTEND_URL);
if (!frontendUp) {
  const prod = args.has('--prod');
  console.log(`  starting frontend (${prod ? 'next start' : 'next dev'})…`);
  pids.frontend = startDetached('frontend', 'npm', ['run', prod ? 'start' : 'dev', '--workspace', 'frontend', '--', '-p', env.FRONTEND_PORT], env);
} else console.log('  frontend already running ✓');
writePids(pids);

// 4. wait for health
process.stdout.write('  waiting for backend health');
const health = await waitFor(`${env.BACKEND_URL}/health`, { timeoutMs: 150000, label: 'backend /health' });
console.log(' ✓');
process.stdout.write('  waiting for frontend');
await waitFor(env.FRONTEND_URL, { timeoutMs: 180000, label: 'frontend' });
console.log(' ✓');

// 5. seed
let seed = null;
if (!args.has('--no-seed')) {
  process.stdout.write('  seeding demo data');
  const r = await fetch(`${env.BACKEND_URL}/api/demo/seed`, { method: 'POST', signal: AbortSignal.timeout(120000) });
  seed = await r.json().catch(() => null);
  console.log(r.ok ? ' ✓' : c.red(` ✖ HTTP ${r.status} ${JSON.stringify(seed)}`));
}

// 6. summary
const ledger = health?.ledger ?? {};
const mode = String(ledger.mode ?? 'unknown').toUpperCase();
const modeLine = ledger.mode === 'mock'
  ? c.yellow('MOCK (Fabric-compatible LedgerClient interface, in-process, file-persisted at .data/ledger.json)')
  : c.green(`${mode} — channel ${ledger.channel} / chaincode ${ledger.chaincode}`);
console.log(`
${c.bold('BillBridge is up')}  ${c.dim(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`)}
  Frontend   ${c.cyan(env.FRONTEND_URL)}
  Backend    ${c.cyan(env.BACKEND_URL)}   Swagger ${c.cyan(`${env.BACKEND_URL}/docs`)}
  Ledger     ${modeLine}
  Block height ${ledger.blockHeight ?? '?'}   Simulated now ${health?.simulatedNow ?? '?'}
  Seed       ${seed ? `${seed.users} users, ${seed.invoices} invoices` : 'skipped'}

  Demo credentials (password ${c.bold(DEMO_PASSWORD)} for all):`);
for (const u of DEMO_USERS) {
  console.log(`    ${u.role.padEnd(9)} ${u.email.padEnd(20)} ${c.dim(u.name)}${u.participantId === 'investor4' ? c.dim('  (tiny cap ₹50,000)') : u.participantId === 'investor5' ? c.dim('  (KYC pending)') : ''}`);
}
console.log(`
  Demo invoice: samples/invoice-aurora-001.pdf (Sharma Precision → Aurora Motors, ₹4,00,000, due +67 days)
  Stop: ${c.bold('make down')}   Reset: ${c.bold('make reset')}   Logs: ${c.bold('make logs')}
`);
if (!args.has('--no-open')) openBrowser(env.FRONTEND_URL);
