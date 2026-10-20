'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { Role, TokenResponse, UserProfile } from '@billbridge/shared';
import { api } from './api';
import { readAuth, subscribeAuth, writeAuth } from './auth-store';
import { ROLE_HOME } from './utils';

interface AuthContextValue {
  user: UserProfile | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<TokenResponse>;
  register: (body: Parameters<typeof api.register>[0]) => Promise<TokenResponse>;
  logout: () => void;
  switchRole: (role: Role, email?: string) => Promise<TokenResponse>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<TokenResponse | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    setAuth(readAuth());
    setReady(true);
    return subscribeAuth(() => setAuth(readAuth()));
  }, []);

  const refreshProfile = useCallback(async () => {
    const cur = readAuth();
    if (!cur) return;
    try {
      const user = await api.me();
      writeAuth({ ...cur, user });
    } catch { /* keep cached profile */ }
  }, []);

  // Re-validate the cached profile (KYC / frozen flags can change behind our back).
  useEffect(() => {
    if (ready && auth) void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const value = useMemo<AuthContextValue>(() => ({
    user: auth?.user ?? null,
    ready,
    login: async (email, password) => {
      const t = await api.login({ email, password });
      writeAuth(t);
      qc.clear();
      router.push(ROLE_HOME[t.user.role] ?? '/');
      return t;
    },
    register: async (body) => {
      const t = await api.register(body);
      writeAuth(t);
      qc.clear();
      router.push(ROLE_HOME[t.user.role] ?? '/');
      return t;
    },
    logout: () => {
      writeAuth(null);
      qc.clear();
      router.push('/login');
    },
    switchRole: async (role, email) => {
      const t = await api.switchRole(email ? { email } : { role });
      writeAuth(t);
      qc.clear();
      router.push(ROLE_HOME[t.user.role] ?? '/');
      return t;
    },
    refreshProfile,
  }), [auth, ready, qc, router, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Redirects to /login when unauthenticated, or to the user's home when their role is not allowed. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = !!user && roles.includes(user.role);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!allowed) router.replace(ROLE_HOME[user.role] ?? '/');
  }, [ready, user, allowed, router, pathname]);

  if (!ready || !allowed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">
        {ready ? 'Redirecting…' : 'Loading session…'}
      </div>
    );
  }
  return <>{children}</>;
}
