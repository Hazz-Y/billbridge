/** Entry point: `npm run dev` (tsx watch) / `npm run start` (tsx). */
import { buildApp } from './app.js';
import { config } from './config.js';

const { app, ctx } = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info({ port: config.port, ledgerMode: ctx.ledgerMode, demoMode: config.demoMode, upiProvider: ctx.upi.name, docs: `${config.backendUrl}/docs` }, 'BillBridge backend ready');
} catch (e) {
  app.log.error({ err: e }, 'failed to start');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
