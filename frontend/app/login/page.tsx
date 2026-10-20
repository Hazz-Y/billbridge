'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { DEMO_PASSWORD, DEMO_USERS, DEMO_USER_BY_ROLE, LoginRequestSchema, ROLES, type Role } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { ROLE_HOME, cn } from '@/lib/utils';
import { ROLE_META } from '@/components/bb/role-meta';

function LoginForm() {
  const { login, user, ready } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(params.get('next') ?? ROLE_HOME[user.role] ?? '/');
  }, [ready, user, router, params]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = LoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({ email: f.email?.[0], password: f.password?.[0] });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const t = await login(parsed.data.email, parsed.data.password);
      toast.success(`Welcome, ${t.user.name}`, { description: `${t.user.role} · ${t.user.orgName}` });
      const next = params.get('next');
      if (next) router.replace(next);
    } catch (err) {
      toast.error('Login failed', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const fill = (role: Role) => {
    setEmail(DEMO_USER_BY_ROLE[role]);
    setPassword(DEMO_PASSWORD);
    setErrors({});
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-5">
      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Use a demo credential chip to autofill, then sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} placeholder="you@company.in" />
              <FieldError>{errors.email}</FieldError>
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} placeholder="••••••••" />
              <FieldError>{errors.password}</FieldError>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
            <p className="text-center text-sm text-muted">New here? <Link href="/register" className="text-primary hover:underline">Create an account</Link></p>
          </form>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Demo accounts</CardTitle>
          <CardDescription>Password for every account: <span className="mono">{DEMO_PASSWORD}</span></CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ROLES.map((r) => {
            const meta = ROLE_META[r];
            const Icon = meta.icon;
            const du = DEMO_USERS.find((d) => d.email === DEMO_USER_BY_ROLE[r]);
            return (
              <button key={r} type="button" onClick={() => fill(r)} className={cn('tap flex items-center gap-2 rounded-xl border border-border px-3 text-left text-sm hover:bg-fg/5', email === DEMO_USER_BY_ROLE[r] && 'border-primary bg-primary/10')}>
                <Icon className="h-4 w-4 text-primary" />
                <span><span className="font-medium">{r}</span><span className="block text-[11px] text-muted">{du?.name}</span></span>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
