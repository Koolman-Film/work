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
 * panel shows: full date (locale-aware), holiday name if any, then a list
 * of each person on leave with their type + status badge.
 *
 * Defaults: today is preselected when it's in the visible month;
 * otherwise the first day of the month.
 *
 * Weekday header labels and date display are derived via Intl.DateTimeFormat
 * using the active locale — no Thai month/weekday names are hardcoded.
 * For the Thai locale, the day-detail header uses Buddhist year (CE+543).
 */

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import type {
  GridDay,
  TeamCalendarAdvance,
  TeamCalendarBirthday,
  TeamCalendarEntry,
  TeamCalendarHoliday,
} from '@/lib/leave/team-calendar-shape';
// IMPORTANT: import from -shape, NOT team-calendar. The latter is
// `server-only` and importing it from a client component will throw
// at build time. The -shape module has the pure helpers + types.
import {
  indexAdvancesByDate,
  indexBirthdaysByDate,
  indexEntriesByDate,
} from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';

/**
 * Build the 7 short weekday labels starting from Sunday (index 0).
 * We pick 7 known Sunday-anchored dates and format each with 'weekday: short'.
 * The dates 2024-12-29 (Sun) through 2025-01-04 (Sat) are a convenient
 * fixed reference week that is always in the past and unambiguous.
 */
function buildWeekdayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2024-12-29 = Sunday, +0..+6 gives Sun..Sat.
  const anchor = new Date(Date.UTC(2024, 11, 29)); // Dec 29 2024 = Sunday UTC
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() + i);
    return fmt.format(d);
  });
}

/** Full locale-aware date for the detail panel header.
 *
 * Thai: weekday + day + month-name (Gregorian) + Buddhist year (CE+543).
 * Others: Intl.DateTimeFormat with { weekday:'long', day:'numeric', month:'long', year:'numeric' }.
 */
function formatFullDate(ymd: string, locale: string): string {
  const [yStr, mStr, dStr] = ymd.split('-');
  const y = Number(yStr);
  const m0 = Number(mStr) - 1;
  const d = Number(dStr);

  if (locale === 'th') {
    // Use a UTC date so time-zone doesn't shift day numbers.
    const date = new Date(Date.UTC(y, m0, d));
    const weekday = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(date);
    const monthName = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      month: 'long',
      timeZone: 'UTC',
    }).format(date);
    const beYear = y + 543;
    return `${weekday} ${d} ${monthName} ${beYear}`;
  }

  const date = new Date(Date.UTC(y, m0, d));
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Compact range "1–5 May" / "1–5 พ.ค." style for secondary line on multi-day entries.
 * Uses Intl so the month name is in the user's locale/script. */
function formatRangeCompact(start: string, end: string, locale: string): string {
  const startDay = Number(start.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  const startYM = start.slice(0, 7);
  const endYM = end.slice(0, 7);

  const [yStr, mStr] = start.split('-');
  const y = Number(yStr);
  const m0 = Number(mStr) - 1;

  if (startYM !== endYM) {
    // Cross-month: show both short dates.
    return `${formatShortDate(start, locale)} – ${formatShortDate(end, locale)}`;
  }

  // Same month: "1–5 <month>" using the locale month name.
  const monthDate = new Date(Date.UTC(y, m0, 1));
  let monthLabel: string;
  if (locale === 'th') {
    monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      month: 'short',
      timeZone: 'UTC',
    }).format(monthDate);
  } else {
    monthLabel = new Intl.DateTimeFormat(locale, {
      month: 'short',
      timeZone: 'UTC',
    }).format(monthDate);
  }
  return `${startDay}–${endDay} ${monthLabel}`;
}

function formatShortDate(ymd: string, locale: string): string {
  const [yStr, mStr, dStr] = ymd.split('-');
  const y = Number(yStr);
  const m0 = Number(mStr) - 1;
  const d = Number(dStr);
  const date = new Date(Date.UTC(y, m0, d));
  if (locale === 'th') {
    const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
    return `${d} ${monthLabel}`;
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

type Props = {
  grid: GridDay[];
  entries: TeamCalendarEntry[];
  holidays: TeamCalendarHoliday[];
  /** Active locale — used for weekday labels and date formatting. Defaults to 'th'. */
  locale?: Locale;
  /** Cash-advance markers (admin calendar only). Defaults to none. */
  advances?: TeamCalendarAdvance[];
  /** Birthday markers (admin calendar only). Defaults to none. */
  birthdays?: TeamCalendarBirthday[];
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
  locale = 'th',
  advances = [],
  birthdays = [],
  detailPosition = 'below',
  onLeaveClick,
  onAdvanceClick,
  busyId = null,
}: Props) {
  const t = useTranslations('calendar');

  // Weekday labels derived from Intl — locale-aware, no hardcoded Thai strings.
  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale), [locale]);

  // Build lookup maps once per props change. The grid re-renders on day
  // selection but the underlying indices don't change, so useMemo keeps
  // the per-cell render cheap (Map.get is O(1)).
  const entriesByDate = useMemo(() => indexEntriesByDate(entries), [entries]);
  const advancesByDate = useMemo(() => indexAdvancesByDate(advances), [advances]);
  const birthdaysByDate = useMemo(() => indexBirthdaysByDate(birthdays), [birthdays]);
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
  const selectedBirthdays = birthdaysByDate.get(selected) ?? [];
  const selectedHoliday = holidayByDate.get(selected) ?? null;

  return (
    <div
      className={cn(
        detailPosition === 'right' &&
          'lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-5',
      )}
    >
      <div>
        {/* Weekday header — locale-aware labels via Intl */}
        <div className="grid grid-cols-7 gap-1 px-0.5 pb-1.5">
          {weekdayLabels.map((w, i) => (
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
            const dayBirthdays = birthdaysByDate.get(cell.date) ?? [];
            // Unified marker list: birthdays first (celebratory, surface them),
            // then leaves, then advances; share the ≤2 + "+N" budget.
            const markers: Array<
              | { kind: 'birthday'; b: TeamCalendarBirthday }
              | { kind: 'leave'; e: TeamCalendarEntry }
              | { kind: 'advance'; a: TeamCalendarAdvance }
            > = [
              ...dayBirthdays.map((b) => ({ kind: 'birthday' as const, b })),
              ...dayEntries.map((e) => ({ kind: 'leave' as const, e })),
              ...dayAdvances.map((a) => ({ kind: 'advance' as const, a })),
            ];
            const isToday = cell.date === todayYmd;
            const isSelected = cell.date === selected;
            const dow = new Date(`${cell.date}T00:00:00.000Z`).getUTCDay();
            const isSunday = dow === 0;

            const leaveAriaCount =
              dayEntries.length > 0
                ? ` (${t('cell.leaveCount', { count: dayEntries.length })})`
                : '';
            const advanceAriaCount =
              dayAdvances.length > 0
                ? ` (${t('cell.advanceCount', { count: dayAdvances.length })})`
                : '';
            const birthdayAriaCount =
              dayBirthdays.length > 0
                ? ` (${t('cell.birthdayCount', { count: dayBirthdays.length })})`
                : '';

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => setSelected(cell.date)}
                aria-pressed={isSelected}
                aria-label={`${cell.day}${holiday ? ` ${holiday}` : ''}${birthdayAriaCount}${leaveAriaCount}${advanceAriaCount}`}
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
                      m.kind === 'birthday' ? (
                        <span
                          key={`b:${m.b.employeeId}`}
                          className="block truncate rounded-sm bg-rose-100 px-0.5 text-[9px] font-medium leading-tight text-rose-800"
                        >
                          🎂 {m.b.shortLabel}
                        </span>
                      ) : m.kind === 'leave' ? (
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

                {/* Birthday cake (top-right) — a large, always-visible badge so a
                    birthday reads at a glance, independent of the name chip and
                    the ≤2 marker budget. */}
                {dayBirthdays.length > 0 && cell.inMonth && (
                  <span aria-hidden="true" className="absolute right-1 top-1 text-2xl leading-none">
                    🎂
                  </span>
                )}

                {/* Holiday red dot (top-right) — visible even when cell has no
                    entries. Hidden when a birthday cake already owns the corner;
                    the red cell tint still flags the holiday. */}
                {holiday && cell.inMonth && dayBirthdays.length === 0 && (
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
          <p className="text-sm font-semibold text-gray-900">{formatFullDate(selected, locale)}</p>
          {selectedHoliday && (
            <p className="mt-0.5 text-xs font-medium text-red-700">
              {t('detail.holiday', { name: selectedHoliday })}
            </p>
          )}
        </header>

        {selectedEntries.length === 0 &&
        selectedAdvances.length === 0 &&
        selectedBirthdays.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-500">{t('detail.empty')}</p>
            {selectedHoliday && (
              <p className="mt-1 text-xs text-gray-400">{t('detail.emptyHolidayNote')}</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {selectedBirthdays.map((b) => (
              <li key={`b:${b.employeeId}`}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rose-100 text-sm">
                    🎂
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{b.employeeName}</p>
                    <p className="mt-0.5 text-xs font-medium text-rose-700">
                      {t('detail.birthdayLabel')}
                    </p>
                  </div>
                </div>
              </li>
            ))}

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
                          <span className="ml-1 text-xs font-normal text-primary-600">
                            {t('detail.youSuffix')}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {e.leaveTypeName}
                      {e.startDate !== e.endDate && (
                        <span className="text-gray-400">
                          {' '}
                          · {formatRangeCompact(e.startDate, e.endDate, locale)}
                        </span>
                      )}
                    </p>
                  </div>
                  <StatusBadge status={e.status} t={t} />
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
                    <p className="mt-0.5 text-xs text-gray-600">
                      {t('detail.advanceLabel', { amount: a.amountLabel })}
                    </p>
                  </div>
                  <StatusBadge status={a.status} t={t} />
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

type TFn = ReturnType<typeof useTranslations<'calendar'>>;

function StatusBadge({ status, t }: { status: 'Pending' | 'Approved'; t: TFn }) {
  if (status === 'Approved') {
    return (
      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
        {t('status.Approved')}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      {t('status.Pending')}
    </span>
  );
}
