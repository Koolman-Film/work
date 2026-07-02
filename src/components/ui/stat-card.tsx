import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dashboard/owner metric tile: label + big tabular number + optional delta/hint.
 *
 * When `onClick` is provided the tile becomes a filter toggle (renders as a
 * `<button>`, shows a hover/active ring). Without it, it renders exactly as
 * before — a static `<div>` — so existing consumers are unaffected.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
  className,
  onClick,
  active = false,
}: {
  label: string;
  value: ReactNode;
  delta?: { dir: 'up' | 'down'; text: string };
  hint?: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-4">
        {label}
      </p>
      <p className="mt-1 truncate font-display text-2xl font-bold leading-none text-ink-1 tabular sm:text-3xl">
        {value}
      </p>
      {delta && (
        <p
          className={cn(
            'mt-2 text-[11px] font-semibold',
            delta.dir === 'up' ? 'text-success-deep' : 'text-danger-deep',
          )}
        >
          {delta.dir === 'up' ? '▲' : '▼'} {delta.text}
        </p>
      )}
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'surface block w-full min-w-0 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-cta',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
          active && 'ring-2 ring-primary-400',
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={cn('surface min-w-0 p-4', className)}>{body}</div>;
}
