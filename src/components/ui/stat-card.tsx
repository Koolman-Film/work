import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Dashboard/owner metric tile: label + big tabular number + optional delta/hint. */
export function StatCard({
  label,
  value,
  delta,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: { dir: 'up' | 'down'; text: string };
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('surface p-4', className)}>
      <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-4">
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-bold leading-none text-ink-1 tabular">
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
    </div>
  );
}
