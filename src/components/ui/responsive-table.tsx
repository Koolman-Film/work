import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Column-driven table that is a semantic <table> at ≥md and stacked
 * label:value cards at <md — the core primitive for readable mobile lists.
 * Generic over the row type T.
 */
export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Omit this field from the mobile card (e.g. a redundant avatar column). */
  hideOnMobile?: boolean;
  className?: string;
};

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Row actions: a trailing table cell on desktop, a card footer on mobile. */
  actions?: (row: T) => ReactNode;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      {/* Desktop: real table (white surface, matching Card/.surface elsewhere) */}
      <div className="hidden overflow-hidden rounded-xl border border-[var(--border-color)] bg-white shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/60 text-left font-display text-xs font-semibold text-ink-3">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('px-5 py-3', c.className)}>
                  {c.header}
                </th>
              ))}
              {actions && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-gray-50/50">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-5 py-3.5', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions && <td className="px-5 py-3.5 text-right">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="surface p-4">
            <dl className="space-y-1.5">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="flex justify-between gap-3 text-sm">
                    <dt className="text-ink-3">{c.header}</dt>
                    <dd className="text-right font-medium text-ink-1">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
            {actions && (
              <div className="mt-3 flex justify-end gap-2 border-t border-[var(--border-color)] pt-3">
                {actions(row)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
