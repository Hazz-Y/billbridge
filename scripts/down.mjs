// make down — stop services started by `make demo` (pid file + whoever listens on the backend/frontend ports).
import { unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PID_FILE, c, killPid, loadEnv, readPids } from './lib.mjs';

const env = loadEnv();
const pids = readPids();
for (const [name, pid] of Object.entries(pids)) { console.log(`  stopping ${name} (pid ${pid})`); killPid(pid); }
try { unlinkSync(PID_FILE); } catch { /* none */ }

// belt and braces: kill whatever still listens on our ports (detached children can outlive the npm wrapper)
const ports = [env.PORT, env.FRONTEND_PORT];
for (const port of ports) {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`], { encoding: 'utf8' });
    for (const pid of (r.stdout ?? '').split(/\s+/).filter((x) => /^\d+$/.test(x) && x !== '0')) {
      console.log(`  killing pid ${pid} on port ${port}`);
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    }
  } else {
    const r = spawnSync('sh', ['-c', `lsof -ti tcp:${port} 2>/dev/null`], { encoding: 'utf8' });
    for (const pid of (r.stdout ?? '').split(/\s+/).filter(Boolean)) { console.log(`  killing pid ${pid} on port ${port}`); try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
  }
}
console.log(c.green('✓ stopped'));
