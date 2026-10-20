// make down — stop services started by `make demo`.
import { unlinkSync } from 'node:fs';
import { PID_FILE, c, killPid, readPids } from './lib.mjs';

const pids = readPids();
for (const [name, pid] of Object.entries(pids)) { console.log(`  stopping ${name} (pid ${pid})`); killPid(pid); }
try { unlinkSync(PID_FILE); } catch { /* none */ }
// belt and braces on Windows: kill anything still bound to our ports
if (process.platform === 'win32') {
  const { spawnSync } = await import('node:child_process');
  for (const port of ['4000', '3000']) {
    const r = spawnSync('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /PID %a /T /F`], { stdio: 'ignore' });
    void r;
  }
}
console.log(c.green('✓ stopped'));
