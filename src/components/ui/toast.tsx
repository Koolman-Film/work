import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'neutral';

const ACCENT: Record<ToastVariant, string> = {
  success: 'border-l-success',
  neutral: 'border-l-ink-3',
};

/**
 * Presentational toast — entrance via the `toast-in` keyframe (Task 1 tokens),
 * exit driven by the `exiting` flag (from `useExitTransition().isExiting`,
 * Task 2) which flips `data-exiting` to fade + slide the toast out. Reduced
 * motion is handled globally (Task 1's guard zeroes both the animation and
 * the transition durations), so no extra branching is needed here.
 */
export function Toast({
  variant = 'neutral',
  exiting = false,
  children,
}: {
  variant?: ToastVariant;
  exiting?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      data-exiting={exiting ? 'true' : undefined}
      style={{ animation: 'toast-in var(--duration-base) var(--ease-out-soft) both' }}
      className={cn(
        'pointer-events-auto w-full max-w-sm rounded-xl border-l-4 bg-surface px-4 py-3',
        'text-sm font-medium text-ink-1 shadow-lg',
        'transition-[opacity,transform] duration-[var(--duration-base)] ease-[var(--ease-out-soft)]',
        'data-[exiting=true]:translate-y-1 data-[exiting=true]:opacity-0',
        ACCENT[variant],
      )}
    >
      {children}
    </div>
  );
}
