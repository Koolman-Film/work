'use client';

import { cn } from '@/lib/utils';

/**
 * Controlled tab strip (Sapphire Editorial `.tab on/off`). Used for list
 * filters like รออนุมัติ / ทั้งหมด / ถังขยะ. Roving arrow-key navigation
 * between tabs; active = brand-tinted with a ring.
 */
export type TabItem = { key: string; label: string; badge?: string | number };

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = items.findIndex((it) => it.key === value);
    const next =
      e.key === 'ArrowRight' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    const target = items[next];
    if (target) onChange(target.key);
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(it.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-display text-xs font-semibold transition',
              on
                ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                : 'text-ink-4 hover:bg-gray-50 hover:text-ink-2',
            )}
          >
            {it.label}
            {it.badge != null && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] tabular',
                  on ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600',
                )}
              >
                {it.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
