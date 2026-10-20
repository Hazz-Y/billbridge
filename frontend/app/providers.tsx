'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { LedgerEventsProvider } from '@/lib/ledger-events';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 3000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(isApiError(err) && (err.status === 401 || err.status === 403 || err.status === 404)) && count < 2,
      },
    },
  }));
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <LedgerEventsProvider>
          <TooltipProvider>
            {children}
            <Toaster position="top-right" richColors closeButton theme="dark" toastOptions={{ className: 'glass !bg-bg-elev !text-fg !border-border' }} />
          </TooltipProvider>
        </LedgerEventsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
