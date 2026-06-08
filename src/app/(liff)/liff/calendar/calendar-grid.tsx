'use client';

/**
 * Calendar grid + day-tap detail panel.
 *
 * The grid is a 7×6 CSS grid (always 6 weeks tall, even when the month
 * only spans 5 — keeps the layout from jumping when you scrub months).
 * Each cell shows:
 *   - Day number (top-left), gray if out-of-month, red if Sunday
 *   - Holiday dot (red) if there's a Holiday on that date
 *   - Up to 2 colored bars indicating people on leave
 *   - "+N" overflow indicator when more than 2
 *
 * Tapping a cell selects it and renders a detail panel BELOW the grid
 * (not a modal — modals on a 320px LIFF screen feel disruptive). The
 * panel shows: full Thai date, holiday name if any, then a list of
 * each person on leave with their type + status badge.
 *
 * Defaults: today is preselected when it's in the visible month;
 * otherwise the first day of the month.
 */

import { useMemo, useState } from 'react';
import type {
  GridDay,
  TeamCalendarAdvance,
  TeamCalendarEntry,
  TeamCalendarHoliday,
} from '@/lib/leave/team-calendar-shape';
// IMPORTANT: import from -shape, NOT team-calendar. The latter is
// `server-only` and importing it from a client component will throw
// at build time. The -shape module has the pure helpers + types.
import { indexAdvancesByDate, indexEntriesByDate } from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';

const WEEKDAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;
const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

type Props = {
  grid: GridDay[];
  entries: TeamCalendarEntry[];
  holidays: TeamCalendarHoliday[];
  /** Cash-advance markers (admin calendar only). Defaults to none. */
  advances?: TeamCalendarAdvance[];
  /**
   * Day-detail panel placement. 'below' (default) stacks it under the grid —
   * the mobile/LIFF layout, left untouched. 'right' moves it beside the grid on
   * lg+ (admin desktop), which shortens the overall height and shrinks the grid
   * into the narrower column. Grid cell rendering is identical in both.
   */
  detailPosition?: 'below' | 'right';
  /** When provided, day-detail leave rows become buttons opening a review modal. */
  onLeaveClick?: (leaveRequestId: string) => void;
  /** When provided, day-detail advance rows become buttons opening a review modal. */
  onAdvanceClick?: (cashAdvanceId: string) => void;
  /** id of the row currently fetching its modal VM — shows a disabled/busy state. */
  busyId?: string | null;
};

export function CalendarGrid({
  grid,
  entries,
  holidays,
  advances = [],
  detailPosition = 'below',
  onLeaveClick,
  onAdvanceClick,
  busyId = null,
}: Props) {
  // Build lookup maps once per props change. The grid re-renders on day
  // selection but the underlying indices don't change, so useMemo keeps
  // the per-cell render cheap (Map.get is O(1)).
  const entriesByDate = useMemo(() => indexEntriesByDate(entries), [entries]);
  const advancesByDate = useMemo(() => indexAdvancesByDate(advances), [advances]);
  const holidayByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidays) m.set(h.date, h.name);
    return m;
  }, [holidays]);

  // Default selection: today if in the visible month, else day 1.
  const todayYmd = useMemo(() => {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  }, []);
  const defaultSelected = useMemo(() => {
    const todayCell = grid.find((g) => g.date === todayYmd && g.inMonth);
    if (todayCell) return todayCell.date;
    const firstInMonth = grid.find((g) => g.inMonth);
    // buildMonthGrid contractually returns 42 cells, but TS can't see that
    // through noUncheckedIndexedAccess. Fall back to today's YMD as a
    // defensive default if the grid is somehow empty.
    return firstInMonth?.date ?? grid[0]?.date ?? todayYmd;
  }, [grid, todayYmd]);

  const [selected, setSelected] = useState<string>(defaultSelected);

  const selectedEntries = entriesByDate.get(selected) ?? [];
  const selectedAdvances = advancesByDate.get(selected) ?? [];
  const selectedHoliday = holidayByDate.get(selected) ?? null;

  return (
    <div
      className={cn(
        detailPosition === 'right' &&
          'lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-5',
      )}
    >
      <div>
        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 px-0.5 pb-1.5">
          {WEEKDAY_LABELS.map((w, i) => (
            <p
              key={w}
              className={cn(
                'text-center text-[10px] font-medium',
                // Sunday + Saturday colored to match cell day colors.
                i === 0 ? 'text-red-500' : 'text-gray-500',
              )}
            >
              {w}
            </p>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {grid.map((cell) => {
            const dayEntries = entriesByDate.get(cell.date) ?? [];
            const holiday = holidayByDate.get(cell.date);
            const dayAdvances = advancesByDate.get(cell.date) ?? [];
            // Unified marker list: leaves first, then advances; share the ≤2 + "+N" budget.
            const markers: Array<
              { kind: 'leave'; e: TeamCalendarEntry } | { kind: 'advance'; a: TeamCalendarAdvance }
            > = [
              ...dayEntries.map((e) => ({ kind: 'leave' as const, e })),
              ...dayAdvances.map((a) => ({ kind: 'advance' as const, a })),
            ];
            const isToday = cell.date === todayYmd;
            const isSelected = cell.date === selected;
            const dow = new Date(`${cell.date}T00:00:00.000Z`).getUTCDay();
            const isSunday = dow === 0;

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => setSelected(cell.date)}
                aria-pressed={isSelected}
                aria-label={`${cell.day}${holiday ? ` ${holiday}` : ''}${
                  dayEntries.length > 0 ? ` (มีลา ${dayEntries.length})` : ''
                }${dayAdvances.length > 0 ? ` (เบิก ${dayAdvances.length})` : ''}`}
                className={cn(
                  'relative flex aspect-square flex-col rounded-md border p-1 text-left transition',
                  // Out-of-month cells: muted background + ghost text.
                  !cell.inMonth && 'border-transparent bg-transparent text-gray-300',
                  cell.inMonth &&
                    !isSelected &&
                    'border-gray-200 bg-white hover:border-primary-200',
                  isSelected && 'border-primary-500 bg-primary-50 ring-2 ring-primary-200',
                  holiday && cell.inMonth && !isSelected && 'border-red-100 bg-red-50/40',
                )}
              >
                <span
                  className={cn(
                    'text-[11px] font-medium leading-none',
                    cell.inMonth && isSunday && 'text-red-600',
                    cell.inMonth && !isSunday && 'text-gray-900',
                    isToday && cell.inMonth && 'rounded-full bg-primary-600 px-1 text-white',
                  )}
                >
                  {cell.day}
                </span>

                {/* Markers — leave bars + ฿ advance chips, up to 2 then "+N" */}
                {cell.inMonth && markers.length > 0 && (
                  <div className="mt-auto flex flex-col gap-0.5">
                    {markers.slice(0, 2).map((m) =>
                      m.kind === 'leave' ? (
                        <span
                          key={`l:${m.e.leaveRequestId}`}
                          className={cn(
                            'block truncate rounded-sm px-0.5 text-[9px] leading-tight',
                            m.e.status === 'Approved'
                              ? 'bg-primary-100 text-primary-800'
                              : 'border border-dashed border-amber-300 bg-amber-50 text-amber-800',
                            m.e.isMine && 'ring-1 ring-primary-400',
                          )}
                        >
                          {m.e.shortLabel}
                        </span>
                      ) : (
                        <span
                          key={`a:${m.a.cashAdvanceId}`}
                          className={cn(
                            'block truncate rounded-sm px-0.5 text-[9px] leading-tight',
                            m.a.status === 'Approved'
                              ? 'bg-green-100 text-green-800'
                              : 'border border-dashed border-green-300 bg-green-50 text-green-800',
                          )}
                        >
                          {m.a.amountLabel}
                        </span>
                      ),
                    )}
                    {markers.length > 2 && (
                      <span className="text-[9px] font-medium leading-none text-gray-500">
                        +{markers.length - 2}
                      </span>
                    )}
                  </div>
                )}

                {/* Holiday red dot (top-right) — visible even when cell has no entries */}
                {holiday && cell.inMonth && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-red-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail panel — beside the grid on lg in 'right' mode, below otherwise */}
      <section
        className={cn(
          'rounded-xl border border-gray-200 bg-white',
          detailPosition === 'right' ? 'mt-4 lg:mt-0' : 'mt-4',
        )}
      >
        <header className="border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">{formatThaiDate(selected)}</p>
          {selectedHoliday && (
            <p className="mt-0.5 text-xs font-medium text-red-700">วันหยุด: {selectedHoliday}</p>
          )}
        </header>

        {selectedEntries.length === 0 && selectedAdvances.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-500">ไม่มีรายการวันนี้</p>
            {selectedHoliday && <p className="mt-1 text-xs text-gray-400">เนื่องจากเป็นวันหยุด</p>}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {selectedEntries.map((e) => {
              const body = (
                <>
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold',
                      e.isMine ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600',
                    )}
                  >
                    {(e.shortLabel[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {e.employeeName}
                        {e.isMine && (
                          <span className="ml-1 text-xs font-normal text-primary-600">(คุณ)</span>
                        )}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {e.leaveTypeName}
                      {e.startDate !== e.endDate && (
                        <span className="text-gray-400">
                          {' '}
                          · {formatRangeCompact(e.startDate, e.endDate)}
                        </span>
                      )}
                    </p>
                  </div>
                  <StatusBadge status={e.status} />
                </>
              );
              return (
                <li key={e.leaveRequestId}>
                  {onLeaveClick ? (
                    <button
                      type="button"
                      disabled={busyId === e.leaveRequestId}
                      onClick={() => onLeaveClick(e.leaveRequestId)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 disabled:opacity-60"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}

            {selectedAdvances.map((a) => {
              const body = (
                <>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-green-100 text-xs font-bold text-green-700">
                    ฿
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{a.employeeName}</p>
                    <p className="mt-0.5 text-xs text-gray-600">เบิกเงิน · {a.amountLabel}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </>
              );
              return (
                <li key={a.cashAdvanceId}>
                  {onAdvanceClick ? (
                    <button
                      type="button"
                      disabled={busyId === a.cashAdvanceId}
                      onClick={() => onAdvanceClick(a.cashAdvanceId)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 disabled:opacity-60"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: 'Pending' | 'Approved' }) {
  if (status === 'Approved') {
    return (
      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
        อนุมัติแล้ว
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      รออนุมัติ
    </span>
  );
}

/** Full Thai date with Buddhist year — used for the detail panel header. */
function formatThaiDate(ymd: string): string {
  const [yStr, mStr, dStr] = ymd.split('-');
  const y = Number(yStr);
  const m0 = Number(mStr) - 1;
  const d = Number(dStr);
  const weekday = new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    weekday: 'long',
  });
  return `${weekday} ${d} ${THAI_MONTHS[m0]} ${y + 543}`;
}

/** Compact "1–5 พ.ค." style for the secondary line on multi-day entries. */
function formatRangeCompact(start: string, end: string): string {
  const startDay = Number(start.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  // If the range crosses months we just show both full dates.
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    return `${formatShort(start)} – ${formatShort(end)}`;
  }
  const monthLabel = THAI_MONTHS[Number(start.slice(5, 7)) - 1];
  return `${startDay}–${endDay} ${monthLabel}`;
}

function formatShort(ymd: string): string {
  const day = Number(ymd.slice(8, 10));
  const m0 = Number(ymd.slice(5, 7)) - 1;
  return `${day} ${THAI_MONTHS[m0]}`;
}
