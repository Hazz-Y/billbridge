import type { Role } from '@billbridge/shared';
import type { User } from '@prisma/client';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { verifyAccessToken } from './jwt.js';

export type AuthUser = User & { role: Role };

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser }
}

function extractToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const q = req.query as Record<string, unknown> | undefined;
  const t = q?.['token'];
  if (typeof t === 'string' && t) return t;
  // Zod strips unknown query keys before preHandler runs; fall back to the raw URL (SSE / CSV links use ?token=).
  const raw = new URL(req.raw.url ?? '/', 'http://x').searchParams.get('token');
  return raw && raw !== '' ? raw : null;
}

export async function authenticate(ctx: AppContext, req: FastifyRequest): Promise<AuthUser | null> {
  const token = extractToken(req);
  if (!token) return null;
  const claims = verifyAccessToken(token, ctx.config.jwt.accessSecret);
  if (!claims) return null;
  const user = await ctx.db.user.findUnique({ where: { id: claims.sub } });
  if (!user) return null;
  return user as AuthUser;
}

export function requireAuth(ctx: AppContext): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = await authenticate(ctx, req);
    if (!user) throw new HttpError(401, 'ERR_AUTH', 'missing or invalid access token');
    req.user = user;
    req.log = req.log.child({ userId: user.id, participantId: user.participantId });
  };
}

export function requireRole(ctx: AppContext, ...roles: Role[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = await authenticate(ctx, req);
    if (!user) throw new HttpError(401, 'ERR_AUTH', 'missing or invalid access token');
    if (!roles.includes(user.role)) throw new HttpError(403, 'ERR_FORBIDDEN', `requires role ${roles.join('|')}, you are ${user.role}`, { required: roles, actual: user.role });
    req.user = user;
    req.log = req.log.child({ userId: user.id, participantId: user.participantId });
  };
}

/** Narrowing helper for handlers that run after requireAuth/requireRole. */
export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'ERR_AUTH', 'not authenticated');
  return req.user;
}
