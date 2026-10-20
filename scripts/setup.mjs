// make setup — install deps, generate Prisma client, sample PDFs. Idempotent.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, c, has, loadEnv, run } from './lib.mjs';

const env = loadEnv();
console.log(c.bold('\n▶ BillBridge setup'));

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) { console.error(c.red(`Node ${process.versions.node} is too old; need >= 20`)); process.exit(1); }
console.log(`  node ${process.versions.node} ✓`);

const needInstall = !existsSync(join(ROOT, 'node_modules', '.package-lock.json')) || process.argv.includes('--force')
  || !existsSync(join(ROOT, 'node_modules', 'next')) || !existsSync(join(ROOT, 'node_modules', 'fastify'));
if (needInstall) {
  console.log('  installing npm workspaces (this can take a few minutes)…');
  run('npm', ['install', '--no-fund', '--no-audit'], { env });
} else console.log('  npm dependencies present ✓');

console.log('  prisma generate + db push…');
run('npm', ['run', 'prisma:generate', '--workspace', 'backend'], { env });
run('npm', ['run', 'prisma:push', '--workspace', 'backend'], { env });

if (!existsSync(join(ROOT, 'samples', 'invoice-aurora-001.pdf')) || process.argv.includes('--force')) {
  console.log('  generating sample invoice PDFs…');
  run('npm', ['run', 'samples', '--workspace', 'backend'], { env });
} else console.log('  sample PDFs present ✓');

if (has('go', ['version'], env)) {
  console.log('  go mod download (chaincode)…');
  run('go', ['mod', 'download'], { env, cwd: join(ROOT, 'chaincode', 'billbridge'), allowFail: true });
} else console.log(c.yellow('  go not found — chaincode tests will be skipped (ledger runs in mock mode anyway)'));

console.log(c.green('✓ setup complete\n'));
