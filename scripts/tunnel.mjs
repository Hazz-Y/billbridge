// make tunnel — optional Cloudflare quick tunnel for remote demos (P2). Requires `cloudflared` on PATH.
import { c, has, loadEnv, run } from './lib.mjs';

const env = loadEnv();
if (!has('cloudflared', ['--version'], env)) {
  console.log(c.yellow('cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
  process.exit(1);
}
console.log(c.dim('Note: the frontend calls the backend at NEXT_PUBLIC_API_URL; for a remote demo tunnel the backend too and rebuild with that URL.'));
run('cloudflared', ['tunnel', '--url', env.FRONTEND_URL], { env });
