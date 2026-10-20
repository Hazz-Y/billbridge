import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, c } from './lib.mjs';

console.log(c.bold('\nBillBridge — make targets\n'));
for (const line of readFileSync(join(ROOT, 'Makefile'), 'utf8').split(/\r?\n/)) {
  const m = /^([a-z-]+):.*?##\s*(.*)$/.exec(line);
  if (m) console.log(`  ${c.cyan(m[1].padEnd(16))} ${m[2]}`);
}
console.log(`\n  Start here: ${c.bold('make demo')}\n`);
