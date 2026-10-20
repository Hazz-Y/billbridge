/** Minimal HS256 JWT (access tokens). Refresh tokens are opaque random strings stored hashed in SQLite. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AccessClaims { sub: string; participantId: string; role: string; iat: number; exp: number }

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

export function signAccessToken(claims: Omit<AccessClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload: AccessClaims = { ...claims, iat, exp: iat + ttlSeconds };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
    if (typeof claims.sub !== 'string') return null;
    return claims;
  } catch { return null; }
}

export function newRefreshToken(): string { return randomBytes(32).toString('base64url'); }
