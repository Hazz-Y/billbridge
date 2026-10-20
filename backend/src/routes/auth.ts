import { LoginRequestSchema, RefreshRequestSchema, RegisterRequestSchema, TokenResponseSchema, UserProfileSchema } from '@billbridge/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { currentUser, requireAuth } from '../auth/hooks.js';
import { buildProfile, login, refresh, register } from '../auth/service.js';
import type { AppContext } from '../context.js';

export async function authRoutes(fastify: FastifyInstance, ctx: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.post('/api/auth/register', { schema: { tags: ['auth'], body: RegisterRequestSchema, response: { 200: TokenResponseSchema } } }, async (req) => register(ctx, req.body));
  app.post('/api/auth/login', { schema: { tags: ['auth'], body: LoginRequestSchema, response: { 200: TokenResponseSchema } } }, async (req) => login(ctx, req.body.email, req.body.password));
  app.post('/api/auth/refresh', { schema: { tags: ['auth'], body: RefreshRequestSchema, response: { 200: TokenResponseSchema } } }, async (req) => refresh(ctx, req.body.refreshToken));
  app.get('/api/auth/me', { schema: { tags: ['auth'], security: [{ bearerAuth: [] }], response: { 200: UserProfileSchema } }, preHandler: requireAuth(ctx) }, async (req) => buildProfile(ctx, currentUser(req)));
}
