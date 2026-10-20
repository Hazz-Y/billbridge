// make logs — tail backend + frontend logs.
import { existsSync, readFileSync, statSync, watchFile } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR, c } from './lib.mjs';

const files = ['backend', 'frontend'].map((n) => ({ n, p: join(LOG_DIR, `${n}.log`), pos: 0 }));
for (const f of files) {
  if (!existsSync(f.p)) { console.log(c.dim(`(no ${f.n} log yet)`)); continue; }
  const txt = readFileSync(f.p, 'utf8');
  const tail = txt.split('\n').slice(-40).join('\n');
  console.log(c.bold(`── ${f.n} ──`)); console.log(tail);
  f.pos = statSync(f.p).size;
  watchFile(f.p, { interval: 500 }, (cur) => {
    if (cur.size <= f.pos) return;
    const buf = readFileSync(f.p, 'utf8').slice(f.pos);
    f.pos = cur.size;
    process.stdout.write(buf.split('\n').filter(Boolean).map((l) => `${c.cyan(f.n.padEnd(8))} ${l}`).join('\n') + '\n');
  });
}
console.log(c.dim('watching… Ctrl-C to stop'));
