'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { RegisterRequestSchema, isValidGstin, type Role } from '@billbridge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ROLE_META } from '@/components/bb/role-meta';

const SELF_SERVE: Array<'MSME' | 'BUYER' | 'INVESTOR'> = ['MSME', 'BUYER', 'INVESTOR'];
type Errors = Partial<Record<'email' | 'password' | 'name' | 'orgName' | 'gstin' | 'vpa' | 'role', string>>;

export default function RegisterPage() {
  const { register } = useAuth();
  const [role, setRole] = useState<Role>('MSME');
  const [form, setForm] = useState({ email: '', password: '', name: '', orgName: '', gstin: '', vpa: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const needsGstin = role === 'MSME' || role === 'BUYER';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...form, role, gstin: form.gstin.trim().toUpperCase() || undefined, vpa: form.vpa.trim() || undefined };
    const parsed = RegisterRequestSchema.safeParse(body);
    const next: Errors = {};
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      (Object.keys(f) as Array<keyof Errors>).forEach((k) => { next[k] = f[k]?.[0]; });
    }
    if (needsGstin && !body.gstin) next.gstin = 'GSTIN is required for suppliers and buyers';
    else if (body.gstin && !isValidGstin(body.gstin)) next.gstin = 'Invalid GSTIN (format or check digit)';
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;
    setBusy(true);
    try {
      const t = await register(parsed.data);
      toast.success(`Account created for ${t.user.name}`, { description: t.user.kycStatus === 'PENDING' ? 'KYC pending — an operator must approve before you can transact.' : undefined });
    } catch (err) {
      toast.error('Registration failed', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create an account</h1>
        <p className="text-sm text-muted">Operator and regulator identities are provisioned by the platform; choose your role below.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {SELF_SERVE.map((r) => {
          const m = ROLE_META[r];
          const Icon = m.icon;
          return (
            <button key={r} type="button" onClick={() => setRole(r)} className={cn('glass flex min-h-[44px] flex-col items-start gap-1 rounded-2xl p-4 text-left transition-colors hover:bg-fg/5', role === r && 'border-primary ring-2 ring-ring')} aria-pressed={role === r}>
              <Icon className="h-5 w-5 text-primary" />
              <span className="font-medium">{m.title}</span>
              <span className="text-xs text-muted">{m.blurb}</span>
            </button>
          );
        })}
      </div>
      <Card>
        <CardHeader><CardTitle>Details</CardTitle><CardDescription>All data is synthetic in this sandbox.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
            <div><Label htmlFor="name">Your name</Label><Input id="name" value={form.name} onChange={set('name')} invalid={!!errors.name} /><FieldError>{errors.name}</FieldError></div>
            <div><Label htmlFor="orgName">Organisation</Label><Input id="orgName" value={form.orgName} onChange={set('orgName')} invalid={!!errors.orgName} /><FieldError>{errors.orgName}</FieldError></div>
            <div><Label htmlFor="email">Email</Label><Input id="email" type="email" value={form.email} onChange={set('email')} invalid={!!errors.email} /><FieldError>{errors.email}</FieldError></div>
            <div><Label htmlFor="password">Password (min 8)</Label><Input id="password" type="password" value={form.password} onChange={set('password')} invalid={!!errors.password} /><FieldError>{errors.password}</FieldError></div>
            <div><Label htmlFor="gstin">GSTIN {needsGstin ? '' : '(optional)'}</Label><Input id="gstin" mono maxLength={15} value={form.gstin} onChange={set('gstin')} invalid={!!errors.gstin} placeholder="27AAACS1234A1ZX" /><FieldError>{errors.gstin}</FieldError></div>
            <div><Label htmlFor="vpa">UPI VPA (optional)</Label><Input id="vpa" mono value={form.vpa} onChange={set('vpa')} invalid={!!errors.vpa} placeholder="name@upi" /><FieldError>{errors.vpa}</FieldError></div>
            <div className="sm:col-span-2">
              <Button type="submit" size="lg" className="w-full" loading={busy}>Create {ROLE_META[role].title} account</Button>
              <p className="mt-3 text-center text-sm text-muted">Already registered? <Link href="/login" className="text-primary hover:underline">Sign in</Link></p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
