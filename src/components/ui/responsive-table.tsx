import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from './scroll-area';

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
  /**
   * Extra classes for this column's th/td. Applied AFTER the defaults, so
   * tailwind-merge lets a column opt out of the no-wrap default with
   * `whitespace-normal` — do that for genuinely long prose (a leave reason,
   * an audit note). Everything else reads better scrolled than stacked.
   */
  className?: string;
};

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
  onRowClick,
  minWidth,
  renderMobileRow,
  collapsing,
  rowClassName,
  rowStyle,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Row actions: a trailing table cell on desktop, a card footer on mobile. */
  actions?: (row: T) => ReactNode;
  empty?: ReactNode;
  /**
   * Makes whole rows clickable (e.g. open a detail modal). Function prop —
   * only usable when the table is rendered from a client component.
   */
  onRowClick?: (row: T) => void;
  /**
   * Min width for the desktop table (Tailwind class, e.g. `md:min-w-[60rem]`).
   * Wide tables that would otherwise crush their columns set this so the
   * desktop wrapper scrolls horizontally instead. Omit for tables that fit.
   */
  minWidth?: string;
  /**
   * Replaces the default label:value card on mobile with a purpose-built row,
   * rendered into a single divided list rather than one card per record.
   *
   * The default stacking transposes the table — every column becomes a
   * `label : value` pair — which is right for genuinely tabular data (a payroll
   * line, a holiday) and wrong when a row is a THING with a name. On the
   * employees list it made the person's name the value of a "ชื่อ" field, so
   * the card had no heading and repeated five labels per record.
   *
   * Opt-in per call site precisely because most of the other twelve callers
   * are tabular and should keep the default. The renderer owns its own tap
   * target: `onRowClick` is a function prop, so a Server Component page cannot
   * pass one and wraps its row in a <Link> instead. `actions` is not rendered
   * in this mode — the row itself is the affordance.
   */
  renderMobileRow?: (row: T) => ReactNode;
  /**
   * Marks a row as animating away: stamps `data-exiting` on the <tr>, which
   * globals.css fades out. Mobile rows get the height-collapsing
   * `.u-collapse-wrap` instead, since outside a table the wrapper IS the row
   * and is free to be a grid. See globals.css for why a table row fades
   * rather than collapses.
   */
  collapsing?: (row: T) => boolean;
  /** Extra classes on the <tr>/<li> — a loading shimmer, an entrance animation. */
  rowClassName?: (row: T, index: number) => string | undefined;
  /** Inline style per row. Exists for the one thing a class cannot express:
   *  a per-row `animationDelay`, which is what makes an entrance cascade
   *  rather than firing every row at once. */
  rowStyle?: (row: T, index: number) => CSSProperties | undefined;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  /** Click + Enter/Space handlers shared by the desktop row and mobile card. */
  const rowInteraction = (row: T) =>
    onRowClick
      ? {
          onClick: () => onRowClick(row),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRowClick(row);
            }
          },
          tabIndex: 0,
        }
      : {};

  return (
    <>
      {/* Desktop: real table (white surface, matching Card/.surface elsewhere).
          overflow-x-auto so wide tables scroll horizontally rather than crush
          their columns; only kicks in when a `minWidth` pushes the table past
          its container. */}
      <ScrollArea className="hidden rounded-xl border border-line bg-surface md:block">
        <table className={cn('w-full text-sm', minWidth)}>
          <thead className="bg-surface-muted/60 text-left font-display text-xs font-semibold text-ink-3">
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
            {rows.map((row, index) => (
              <tr
                key={rowKey(row)}
                data-exiting={collapsing ? collapsing(row) : undefined}
                style={rowStyle?.(row, index)}
                className={cn(
                  'hover:bg-surface-hover/50',
                  onRowClick &&
                    'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-400',
                  rowClassName?.(row, index),
                )}
                {...rowInteraction(row)}
              >
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
      </ScrollArea>

      {/* Mobile: a caller-supplied divided list, else stacked label:value cards. */}
      {renderMobileRow ? (
        <ul className="divide-y divide-[var(--border-color)] overflow-hidden rounded-xl border border-line bg-surface md:hidden">
          {rows.map((row, index) => (
            <li
              key={rowKey(row)}
              className={rowClassName?.(row, index)}
              style={rowStyle?.(row, index)}
            >
              {/* `u-collapse-wrap`, not `u-collapse-cell`: outside a table the
                  wrapper IS the row, so it takes `data-exiting` on itself. The
                  cell variant only reacts to the attribute on an ancestor
                  <tr>, and would silently never animate here. */}
              {collapsing ? (
                <div className="u-collapse-wrap" data-exiting={collapsing(row)}>
                  <div>{renderMobileRow(row)}</div>
                </div>
              ) : (
                renderMobileRow(row)
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-3 md:hidden">
          {rows.map((row) => (
            <li
              key={rowKey(row)}
              className={cn(
                'surface p-4',
                onRowClick &&
                  'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-400',
              )}
              {...rowInteraction(row)}
            >
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
      )}
    </>
  );
}
