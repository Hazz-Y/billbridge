// make reset — wipe ledger + DB and reseed through the running backend (< 30 s). `--seed-only` just seeds.
import { c, loadEnv } from './lib.mjs';

const env = loadEnv();
const seedOnly = process.argv.includes('--seed-only');
const t0 = Date.now();
const url = `${env.BACKEND_URL}/api/demo/${seedOnly ? 'seed' : 'reset'}`;
try {
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(120000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(c.red(`✖ ${url} → HTTP ${r.status} ${JSON.stringify(body)}`)); process.exit(1); }
  console.log(c.green(`✓ ${seedOnly ? 'seeded' : 'reset + reseeded'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`), c.dim(JSON.stringify(body)));
} catch (e) {
  console.error(c.red(`✖ backend not reachable at ${env.BACKEND_URL} — run \`make demo\` first (${e?.message ?? e})`));
  process.exit(1);
}
