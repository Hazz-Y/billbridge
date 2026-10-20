'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Building2, FileText, Landmark, LogOut, Moon, ScanSearch, ShieldCheck, Sun, TrendingUp, UserCircle2, Home } from 'lucide-react';
import type { Role } from '@billbridge/shared';
import { useAuth } from '@/lib/auth';
import { cn, isMockMode } from '@/lib/utils';
import { LedgerBadge, SandboxBanner, ledgerModeLabel } from './ledger-badge';
import { DemoPanel } from './demo-panel';
import { useNetwork } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';

const ROLE_LINKS: Record<Role, { href: string; label: string; icon: typeof FileText }> = {
  MSME: { href: '/msme', label: 'Invoices', icon: FileText },
  BUYER: { href: '/buyer', label: 'Buyer', icon: Building2 },
  INVESTOR: { href: '/investor', label: 'Invest', icon: TrendingUp },
  OPERATOR: { href: '/operator', label: 'Operate', icon: Landmark },
  REGULATOR: { href: '/regulator', label: 'Audit', icon: ScanSearch },
};

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light') setTheme('light');
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('bb.theme', next); } catch { /* ignore */ }
  };
  return { theme, toggle };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, ready } = useAuth();
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const net = useNetwork();

  const links = user ? [ROLE_LINKS[user.role]] : [];
  const nav = [{ href: '/', label: 'Home', icon: Home }, ...links];

  return (
    <div className="flex min-h-dvh flex-col">
      <SandboxBanner />
      <header className="sticky top-0 z-40 border-b border-border bg-bg/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><ShieldCheck className="h-5 w-5" /></span>
            <span>BillBridge</span>
            {isMockMode() && <Badge tone="warning" className="ml-1">mock data</Badge>}
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {nav.map((l) => (
              <Link key={l.href} href={l.href} className={cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href)) ? 'bg-primary/20 text-fg' : 'text-muted hover:text-fg')}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LedgerBadge compact className="hidden lg:inline-flex" />
            <button onClick={toggle} className="tap inline-flex items-center justify-center rounded-xl text-muted hover:bg-fg/10 hover:text-fg" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            {ready && (user ? (
              <div className="flex items-center gap-2">
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-medium leading-tight">{user.name}</div>
                  <div className="mono text-[11px] text-muted">{user.role} · {user.participantId}</div>
                </div>
                <button onClick={logout} className="tap inline-flex items-center justify-center rounded-xl text-muted hover:bg-fg/10 hover:text-fg" aria-label="Log out"><LogOut className="h-5 w-5" /></button>
              </div>
            ) : (
              <Link href="/login" className="tap inline-flex items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-white"><UserCircle2 className="h-4 w-4" /> Login</Link>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-6 md:pb-10">{children}</main>

      <footer className="hidden border-t border-border md:block">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-muted">
          <div className="flex items-center gap-3">
            <LedgerBadge />
            <span>{ledgerModeLabel(net.data?.ledgerMode)} — the mock implements the same chaincode interface; switch via LEDGER_MODE on the backend.</span>
          </div>
          <span>BillBridge prototype · synthetic data only</span>
        </div>
      </footer>

      {/* Mobile bottom tab nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden" aria-label="Mobile">
        <ul className="grid auto-cols-fr grid-flow-col">
          {nav.map((l) => {
            const active = pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href));
            const Icon = l.icon;
            return (
              <li key={l.href}>
                <Link href={l.href} className={cn('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'text-primary' : 'text-muted')}>
                  <Icon className="h-5 w-5" />{l.label}
                </Link>
              </li>
            );
          })}
          {!user && (
            <li><Link href="/login" className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] text-muted"><UserCircle2 className="h-5 w-5" />Login</Link></li>
          )}
        </ul>
      </nav>

      <DemoPanel />
    </div>
  );
}
