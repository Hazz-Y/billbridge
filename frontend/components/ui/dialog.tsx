'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />;
}

/** Centered modal on desktop, bottom sheet on mobile. */
export function DialogContent({ className, children, title, description, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 border border-border bg-bg-elev p-5 shadow-2xl focus:outline-none',
          'inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl',
          'md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="tap -mr-2 -mt-2 inline-flex items-center justify-center rounded-xl text-muted hover:bg-fg/10 hover:text-fg" aria-label="Close">
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Side sheet (right on desktop, bottom on mobile). */
export function SheetContent({ className, children, title, description, side = 'right', ...props }: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string; side?: 'right' | 'left' }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col border border-border bg-bg-elev shadow-2xl focus:outline-none',
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl',
          'md:inset-y-0 md:bottom-auto md:max-h-none md:w-full md:max-w-xl md:rounded-none',
          side === 'right' ? 'md:left-auto md:right-0 md:border-l' : 'md:right-auto md:left-0 md:border-r',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="tap -mr-2 -mt-2 inline-flex items-center justify-center rounded-xl text-muted hover:bg-fg/10 hover:text-fg" aria-label="Close">
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', danger = false, loading = false, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children}
        <div className="flex justify-end gap-2">
          <DialogPrimitive.Close className="tap rounded-xl px-4 text-sm font-medium hover:bg-fg/10">Cancel</DialogPrimitive.Close>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn('tap rounded-xl px-4 text-sm font-medium text-white disabled:opacity-50', danger ? 'bg-danger' : 'bg-primary')}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
