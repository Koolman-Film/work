import type { ReactNode } from 'react';

/**
 * Consistent "no data" content — centered icon/title/hint/action.
 *
 * Plain by design (no card chrome) so it drops cleanly into a Card body or a
 * list container without double-boxing. For a standalone boxed empty state,
 * wrap it in a `Card`/`.surface` at the call site.
 */
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
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      {icon && <div className="text-ink-4">{icon}</div>}
      <p className="font-display text-sm font-semibold text-ink-1">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
