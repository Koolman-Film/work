import type { ReactNode } from 'react';

/** Consistent "no data" panel inside a surface card. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-ink-4">{icon}</div>}
      <p className="font-display text-sm font-semibold text-ink-1">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
