/** `npm run seed --workspace backend` — seeds through the same code path as POST /api/demo/seed (no HTTP server needed). */
import { buildApp } from '../app.js';
import { seed } from './seed.js';

const { app, ctx } = await buildApp({ logger: { level: 'warn' }, demoRoutes: true });
try {
  const r = await seed(ctx);
  console.log(JSON.stringify(r));
} finally {
  await app.close();
}
