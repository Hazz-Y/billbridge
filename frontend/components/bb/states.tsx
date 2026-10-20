'use client';
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-5">
      <Skeleton className="h-5 w-1/2" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={i % 2 ? 'w-2/3' : 'w-5/6'} />)}
    </div>
  );
}

export function EmptyState({ title, description, icon, action, className }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('glass flex flex-col items-center justify-center gap-2 rounded-2xl p-8 text-center', className)}>
      <div className="rounded-full bg-fg/5 p-3 text-muted">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <div className="font-medium">{title}</div>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, title = 'Could not load' }: { error: unknown; onRetry?: () => void; className?: string; title?: string }) {
  const code = isApiError(error) ? error.code : undefined;
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-2xl border border-danger/40 bg-danger/10 p-6 text-center', className)} role="alert">
      <AlertTriangle className="h-6 w-6 text-danger" />
      <div className="font-medium">{title}</div>
      <p className="max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {code && <span className="mono text-xs text-danger">{code}</span>}
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Retry</Button>}
    </div>
  );
}

/** skeleton -> error -> empty -> data, in that order. */
export function DataState<T>({ query, isEmpty, empty, skeleton, children }: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <CardSkeleton />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data as T;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children(data)}</>;
}
