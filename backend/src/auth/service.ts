import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  LedgerError, ROLE_MSP, MSP_ORG_NAME, type RegisterRequest, type Role, type TokenResponse, type UserProfile,
} from '@billbridge/shared';
import type { User } from '@prisma/client';
import type { AppContext, } from '../context.js';
import { HttpError } from '../context.js';
import { callerFor, operatorCaller } from '../ledger/identity.js';
import { newRefreshToken, signAccessToken } from './jwt.js';

export type DbUser = User;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function participantIdFor(email: string, role: Role): string {
  const local = email.split('@')[0] ?? 'user';
  const slug = local.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
  return `${role.toLowerCase()}-${slug}-${sha256(email).slice(0, 6)}`;
}

export async function hashPassword(pw: string): Promise<string> { return bcrypt.hash(pw, 8); }

export async function issueTokens(ctx: AppContext, user: DbUser): Promise<TokenResponse> {
  const accessToken = signAccessToken({ sub: user.id, participantId: user.participantId, role: user.role }, ctx.config.jwt.accessSecret, ctx.config.jwt.accessTtlSeconds);
  const refreshToken = newRefreshToken();
  await ctx.db.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + ctx.config.jwt.refreshTtlSeconds * 1000) },
  });
  return { accessToken, refreshToken, user: await buildProfile(ctx, user) };
}

export async function buildProfile(ctx: AppContext, user: DbUser): Promise<UserProfile> {
  let kycStatus: UserProfile['kycStatus'] = 'PENDING';
  let frozen = false;
  let frozenReason: string | undefined;
  let perInvoiceCapPaise = 0;
  try {
    const p = await ctx.ledger.getParticipant(callerFor({ role: user.role as Role, participantId: user.participantId }), user.participantId);
    kycStatus = p.kycStatus; frozen = p.frozen; frozenReason = p.frozenReason; perInvoiceCapPaise = p.perInvoiceCapPaise;
  } catch (e) {
    if (!(e instanceof LedgerError && e.code === 'ERR_PARTICIPANT_NOT_FOUND')) throw e;
  }
  return {
    id: user.id, email: user.email, name: user.name, role: user.role as Role, participantId: user.participantId, mspId: user.mspId,
    orgName: user.orgName, vpa: user.vpa, ...(user.gstin ? { gstin: user.gstin } : {}), kycStatus, frozen,
    ...(frozenReason ? { frozenReason } : {}), perInvoiceCapPaise, ledgerMode: ctx.ledgerMode,
  };
}

export async function register(ctx: AppContext, req: RegisterRequest): Promise<TokenResponse> {
  const email = req.email.toLowerCase();
  if (await ctx.db.user.findUnique({ where: { email } })) throw new HttpError(409, 'ERR_DUPLICATE_PARTICIPANT', `email ${email} is already registered`);
  const participantId = participantIdFor(email, req.role);
  const cap = req.role === 'INVESTOR' ? 50_000_000 : 0;
  await ctx.ledger.registerParticipant(operatorCaller(), participantId, req.role, ROLE_MSP[req.role], cap);
  const user = await ctx.db.user.create({
    data: {
      email, passwordHash: await hashPassword(req.password), name: req.name, role: req.role, participantId, mspId: ROLE_MSP[req.role],
      orgName: req.orgName, vpa: req.vpa ?? `${participantId}@upi`, gstin: req.gstin ?? null,
    },
  });
  ctx.log.info({ userId: user.id, participantId, role: req.role }, 'user registered (KYC PENDING)');
  return issueTokens(ctx, user);
}

export async function login(ctx: AppContext, email: string, password: string): Promise<TokenResponse> {
  const user = await ctx.db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'ERR_AUTH', 'invalid email or password');
  return issueTokens(ctx, user);
}

export async function refresh(ctx: AppContext, refreshToken: string): Promise<TokenResponse> {
  const row = await ctx.db.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) throw new HttpError(401, 'ERR_AUTH', 'refresh token invalid or expired');
  const user = await ctx.db.user.findUnique({ where: { id: row.userId } });
  if (!user) throw new HttpError(401, 'ERR_AUTH', 'user no longer exists');
  await ctx.db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  return issueTokens(ctx, user);
}

export function orgNameForMsp(mspId: string): string { return MSP_ORG_NAME[mspId] ?? mspId; }
