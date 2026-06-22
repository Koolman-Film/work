'use client';

/**
 * Expandable report rows — the drill-down island for /admin/reports/*.
 *
 * The page (a Server Component) renders each employee's summary cells AND their
 * detail panel (individual leave/advance entries with date ranges) as plain
 * server JSX, then hands them here. This client island owns only the open/closed
 * state and the leading chevron — no data or formatting logic lives here.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';

export type ExpandableRow = {
  id: string;
  /** Summary <td> cells AFTER the leading toggle column. */
  cells: ReactNode;
  /** Detail content shown when expanded; null = no detail → no chevron. */
  detail: ReactNode | null;
  /** Total column count INCLUDING the leading toggle column (detail colSpan). */
  colSpan: number;
};

export function ExpandableReportRows({ rows }: { rows: ExpandableRow[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {rows.map((r) => {
        const hasDetail = r.detail != null;
        const isOpen = hasDetail && open.has(r.id);
        return (
          <Fragment key={r.id}>
            <tr
              className={hasDetail ? 'cursor-pointer hover:bg-gray-50' : 'hover:bg-gray-50'}
              onClick={hasDetail ? () => toggle(r.id) : undefined}
            >
              <td className="w-6 px-2 py-2.5 align-top text-gray-400">
                {hasDetail ? (
                  isOpen ? (
                    <ChevronDown size={16} aria-label="ย่อรายละเอียด" />
                  ) : (
                    <ChevronRight size={16} aria-label="ดูรายละเอียด" />
                  )
                ) : null}
              </td>
              {r.cells}
            </tr>
            {isOpen && (
              <tr className="bg-gray-50/60">
                <td />
                <td colSpan={r.colSpan - 1} className="px-4 pb-3">
                  {r.detail}
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
