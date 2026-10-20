'use client';
import { TokenResponseSchema, type TokenResponse } from '@billbridge/shared';

const KEY = 'bb.auth';
const listeners = new Set<() => void>();
let cached: TokenResponse | null | undefined;

export function readAuth(): TokenResponse | null {
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    cached = raw ? TokenResponseSchema.parse(JSON.parse(raw)) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function writeAuth(value: TokenResponse | null): void {
  cached = value;
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  } catch { /* storage unavailable (private mode) */ }
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function accessToken(): string | null {
  return readAuth()?.accessToken ?? null;
}
