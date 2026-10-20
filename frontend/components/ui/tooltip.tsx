'use client';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, className, side = 'top', asChild = true }: { content: ReactNode; children: ReactNode; className?: string; side?: 'top' | 'bottom' | 'left' | 'right'; asChild?: boolean }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      {/* a non-asChild trigger would render a <button>; wrap in a span so buttons (even disabled ones) can be children */}
      <TooltipPrimitive.Trigger asChild>{asChild ? children : <span className="inline-flex">{children}</span>}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn('z-[60] max-w-xs rounded-lg border border-border bg-bg-elev px-3 py-2 text-xs text-fg shadow-xl', className)}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-bg-elev" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
