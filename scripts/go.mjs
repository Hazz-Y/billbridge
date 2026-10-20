// run `go <args>` inside chaincode/billbridge with caches redirected (skips cleanly if go is absent).
import { join } from 'node:path';
import { ROOT, c, has, loadEnv, run } from './lib.mjs';

const env = loadEnv();
if (!has('go', ['version'], env)) { console.log(c.yellow('go not installed — skipping chaincode step')); process.exit(0); }
run('go', process.argv.slice(2), { env, cwd: join(ROOT, 'chaincode', 'billbridge') });
