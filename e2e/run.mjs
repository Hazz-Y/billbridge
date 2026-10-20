// Runs Playwright with the browser cache pinned under the repo (keeps a possibly-full system drive clean).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browsers = join(root, '.cache', 'ms-playwright');
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, TMPDIR: join(root, '.cache', 'tmp'), TMP: join(root, '.cache', 'tmp'), TEMP: join(root, '.cache', 'tmp') };
const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
if (!existsSync(join(browsers))) {
  const i = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', env, cwd: dirname(fileURLToPath(import.meta.url)) });
  if (i.status !== 0) process.exit(i.status ?? 1);
}
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: dirname(fileURLToPath(import.meta.url)) });
process.exit(r.status ?? 1);
