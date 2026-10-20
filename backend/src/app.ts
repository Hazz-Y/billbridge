/** Fastify application factory (used by server.ts and the integration tests). */
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError, jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HTTP_STATUS_FOR_CODE, LedgerError, type ErrorCode } from '@billbridge/shared';
import { config, demoRoutesEnabled, type AppConfig } from './config.js';
import { HttpError, type AppContext } from './context.js';
import { createDb, type Db } from './db.js';
import { EventPipeline } from './events/pipeline.js';
import { createLedger, type LedgerBundle } from './ledger/index.js';
import { authRoutes } from './routes/auth.js';
import { demoRoutes } from './routes/demo.js';
import { investRoutes } from './routes/invest.js';
import { invoiceRoutes } from './routes/invoices.js';
import { platformRoutes } from './routes/platform.js';
import { settlementRoutes } from './routes/settlement.js';
import { invalidateStats } from './services/platform.js';
import { NpciSandboxUpiProvider } from './upi/npci.js';
import type { UpiProvider } from './upi/provider.js';
import { sweepExpired } from './upi/service.js';
import { SimulatedUpiProvider } from './upi/simulated.js';

export interface BuildOptions {
  ledger?: LedgerBundle;
  db?: Db;
  config?: AppConfig;
  logger?: boolean | Record<string, unknown>;
  /** Register demo routes regardless of NODE_ENV/DEMO_MODE (tests). */
  demoRoutes?: boolean;
  /** Start the event pipeline + expiry sweep (default true). */
  start?: boolean;
}

export function selectUpiProvider(cfg: AppConfig): UpiProvider {
  if (cfg.upi.npci.baseUrl && cfg.upi.npci.clientId) return new NpciSandboxUpiProvider(cfg.upi.npci);
  return new SimulatedUpiProvider({ webhookSecret: cfg.upi.webhookSecret, skewSeconds: cfg.upi.webhookSkewSeconds });
}

export async function buildApp(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const cfg = opts.config ?? config;
  const loggerOpts = opts.logger ?? {
    level: cfg.logLevel,
    ...(cfg.nodeEnv !== 'production' && process.stdout.isTTY ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
  };
  const app = Fastify({ logger: loggerOpts, bodyLimit: 12 * 1024 * 1024, trustProxy: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const ledgerBundle = opts.ledger ?? (await createLedger(app.log));
  const db = opts.db ?? createDb(cfg.databaseUrl, { quiet: true });
  const upi = selectUpiProvider(cfg);
  const events = new EventPipeline(db, ledgerBundle.ledgerClient, app.log);
  events.onInvalidate = invalidateStats;
  const ctx: AppContext = { config: cfg, db, ledger: ledgerBundle.ledger, ledgerClient: ledgerBundle.ledgerClient, ledgerMode: ledgerBundle.ledgerMode, ledgerBundle, upi, events, log: app.log, timers: [] };

  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID', 'x-upi-signature', 'x-upi-timestamp'], exposedHeaders: ['Content-Disposition'] });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'BillBridge API', description: 'Tokenized MSME invoice financing with UPI-native settlement on a permissioned ledger (sandbox).', version: '0.1.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      tags: [{ name: 'auth' }, { name: 'invoices' }, { name: 'invest' }, { name: 'settlement' }, { name: 'platform' }, { name: 'demo' }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });

  // ── errors ──
  app.setErrorHandler((err: unknown, req, reply) => {
    const send = (status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) => {
      void reply.status(status).send({ error: { code, message, ...(details && Object.keys(details).length ? { details } : {}) } });
    };
    if (err instanceof LedgerError) {
      const status = HTTP_STATUS_FOR_CODE[err.code] ?? 500;
      req.log.warn({ errorCode: err.code, status, details: err.details, invoiceId: err.details['invoiceId'] ?? err.details['existingInvoiceId'] }, `ledger: ${err.message}`);
      return send(status, err.code, err.message, err.details);
    }
    if (err instanceof HttpError) {
      req.log.info({ errorCode: err.code, status: err.status }, err.message);
      return send(err.status, err.code as ErrorCode, err.message, err.details);
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({ path: v.instancePath, message: v.message, keyword: v.keyword }));
      return send(400, 'ERR_VALIDATION', `request validation failed: ${issues.map((i) => `${i.path || '/'} ${i.message}`).join('; ')}`, { issues });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err, cause: err.cause?.issues }, 'response does not match its schema');
      return send(500, 'ERR_INTERNAL', 'response serialization failed', { issues: err.cause?.issues });
    }
    const e = err as { code?: string; statusCode?: number; message?: string; validation?: unknown };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return send(400, 'ERR_VALIDATION', 'file exceeds the 10 MB limit');
    if (e.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE' || e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return send(400, 'ERR_VALIDATION', e.message ?? 'invalid content type');
    if (e.validation) return send(400, 'ERR_VALIDATION', e.message ?? 'validation failed');
    if (e.code === 'FST_ERR_VALIDATION' || e.statusCode === 400) return send(400, 'ERR_VALIDATION', e.message ?? 'bad request');
    if (e.statusCode === 404) return send(404, 'ERR_NOT_FOUND', e.message ?? 'not found');
    req.log.error({ err }, 'unhandled error');
    return send(500, 'ERR_INTERNAL', e.message ?? 'internal error');
  });
  app.setNotFoundHandler((req, reply) => { void reply.status(404).send({ error: { code: 'ERR_NOT_FOUND', message: `route ${req.method} ${req.url} not found` } }); });

  // ── routes ──
  const HealthSchema = z.object({
    ok: z.boolean(), ledger: z.object({ ok: z.boolean(), mode: z.string(), blockHeight: z.number().int(), channel: z.string(), chaincode: z.string(), detail: z.string().optional() }),
    simulatedNow: z.string(), demoMode: z.boolean(), ledgerMode: z.string(), upiProvider: z.string(), version: z.string(),
  });
  app.get('/health', { schema: { tags: ['platform'], response: { 200: HealthSchema } } }, async () => {
    const health = await ctx.ledgerClient.health();
    const clock = await ctx.ledger.getClock({ mspId: 'Org1MSP', role: 'OPERATOR', participantId: 'operator1' }).catch(() => ({ now: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }));
    return { ok: health.ok, ledger: health, simulatedNow: clock.now, demoMode: cfg.demoMode, ledgerMode: ctx.ledgerMode, upiProvider: upi.name, version: '0.1.0' };
  });
  await app.register(async (f) => authRoutes(f, ctx));
  await app.register(async (f) => invoiceRoutes(f, ctx));
  await app.register(async (f) => investRoutes(f, ctx));
  await app.register(async (f) => settlementRoutes(f, ctx));
  await app.register(async (f) => platformRoutes(f, ctx));
  if (opts.demoRoutes ?? demoRoutesEnabled) await app.register(async (f) => demoRoutes(f, ctx));

  if (opts.start !== false) {
    await ledgerBundle.init();
    await events.start();
    const sweep = setInterval(() => { sweepExpired(db).then((n) => { if (n) app.log.info({ expired: n }, 'expired UPI intents'); }).catch((e) => app.log.warn({ err: e }, 'expiry sweep failed')); }, 60000);
    sweep.unref();
    ctx.timers.push(sweep);
  }
  app.addHook('onClose', async () => { for (const t of ctx.timers) clearInterval(t); events.stop(); await db.$disconnect(); });
  return { app, ctx };
}
