'use client';

/**
 * CalendarMonth — shared single-month calendar grid + navigation.
 *
 * Internal building block consumed by DateField and DateRangeField (not a
 * public popover itself — it renders only the panel body: header nav, weekday
 * row, and the 6×7 day grid). Parents own the popover shell (open/close, Esc,
 * outside-click) and pass in view state + selection/range/hover props.
 *
 * Locale handling mirrors the rest of the app's date components
 * (month-picker.tsx, calendar-grid.tsx): Thai gets a bespoke Buddhist-year
 * label + Thai weekday abbreviations; every other locale goes through
 * Intl.DateTimeFormat via the shared @/lib/i18n/format helpers.
 */

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { buildDayGrid, type ISODate } from '@/lib/date/be-calendar';
import type { Locale } from '@/lib/i18n/config';
import { formatMonthYear, formatShortDate } from '@/lib/i18n/format';
import { formatThaiMonthLabel } from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';

const WEEKDAY_TH_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

/** 7 short weekday labels, Sunday-first, via Intl (non-Thai locales). */
function buildWeekdayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2024-12-29 = Sunday — a fixed, unambiguous Sunday-anchored reference week.
  const anchor = new Date(Date.UTC(2024, 11, 29));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() + i);
    return fmt.format(d);
  });
}

function addDays(iso: ISODate, delta: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

type Props = {
  viewYear: number;
  viewMonth0: number;
  selected?: ISODate | null;
  rangeFrom?: ISODate | null;
  rangeTo?: ISODate | null;
  hover?: ISODate | null;
  min?: ISODate;
  max?: ISODate;
  today: ISODate;
  onPick: (iso: ISODate) => void;
  onHover?: (iso: ISODate | null) => void;
  onNavMonth: (delta: number) => void;
};

export function CalendarMonth({
  viewYear,
  viewMonth0,
  selected,
  rangeFrom,
  rangeTo,
  hover,
  min,
  max,
  today,
  onPick,
  onHover,
  onNavMonth,
}: Props) {
  const locale = useLocale() as Locale;
  const [focusedIso, setFocusedIso] = useState<ISODate>(selected ?? today);

  // Keep focus anchored to the selected date when it changes externally
  // (e.g. parent field resets it), so keyboard nav resumes from there.
  useEffect(() => {
    setFocusedIso(selected ?? today);
  }, [selected, today]);

  const monthLabel =
    locale === 'th'
      ? formatThaiMonthLabel(viewYear, viewMonth0)
      : formatMonthYear(`${viewYear}-${String(viewMonth0 + 1).padStart(2, '0')}`, locale);

  const weekdayLabels = locale === 'th' ? WEEKDAY_TH_SHORT : buildWeekdayLabels(locale);

  const grid = buildDayGrid(viewYear, viewMonth0, { min, max, today });

  /** Move focus by `delta` days; if it lands outside the visible month, ask
   * the parent to navigate the view so the focused cell stays visible. */
  function moveFocus(delta: number) {
    const next = addDays(focusedIso, delta);
    const nextMonth = Number(next.slice(5, 7)) - 1;
    const nextYear = Number(next.slice(0, 4));
    setFocusedIso(next);
    if (nextYear !== viewYear || nextMonth !== viewMonth0) {
      const monthDelta = (nextYear - viewYear) * 12 + (nextMonth - viewMonth0);
      onNavMonth(monthDelta);
    }
  }

  function onGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-7);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(7);
        break;
      case 'PageUp':
        e.preventDefault();
        onNavMonth(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        onNavMonth(1);
        break;
      case 'Enter':
        e.preventDefault();
        onPick(focusedIso);
        break;
      default:
        break;
    }
  }

  return (
    <div className="w-64 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg">
      {/* Header: ‹ month label › */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavMonth(-1)}
          aria-label="Previous month"
          className="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ‹
        </button>
        <span className="font-display text-sm font-bold text-ink-1">{monthLabel}</span>
        <button
          type="button"
          onClick={() => onNavMonth(1)}
          aria-label="Next month"
          className="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ›
        </button>
      </div>

      {/* Weekday header — Sunday-first */}
      <div className="grid grid-cols-7 gap-1 px-0.5 pb-1">
        {weekdayLabels.map((w, i) => (
          <p
            key={w}
            className={cn(
              'text-center text-[11px] font-medium',
              i === 0 ? 'text-red-500' : 'text-gray-500',
            )}
          >
            {w}
          </p>
        ))}
      </div>

      {/* Day grid */}
      {/* biome-ignore lint/a11y/useSemanticElements: WAI-ARIA APG's date-picker grid pattern is an interactive widget (div/role="grid"), not tabular data — a <table> would be semantically wrong here. */}
      <div
        role="grid"
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        className="grid grid-cols-7 gap-1 outline-none"
      >
        {grid.map((cell) => {
          const isEndpoint = cell.iso === rangeFrom || cell.iso === rangeTo;
          const isSelected = cell.iso === selected || isEndpoint;
          // Confirmed range: tint strictly between the two endpoints (each
          // endpoint already renders filled). Still picking the second date
          // (rangeTo unset): tint from just after rangeFrom through the
          // hovered cell, inclusive, as a live preview of the pending range.
          const inRange = Boolean(
            rangeFrom &&
              (rangeTo
                ? cell.iso > rangeFrom && cell.iso < rangeTo
                : hover && hover > rangeFrom && cell.iso > rangeFrom && cell.iso <= hover),
          );
          const isFocused = cell.iso === focusedIso;
          const dateLabel = formatShortDate(new Date(`${cell.iso}T00:00:00`), locale);

          return (
            // biome-ignore lint/a11y/useSemanticElements: same grid widget as above — cell is a focusable button, not a <td>.
            <button
              key={cell.iso}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={dateLabel}
              tabIndex={-1}
              disabled={cell.disabled}
              onClick={() => onPick(cell.iso)}
              onMouseEnter={() => onHover?.(cell.iso)}
              onMouseLeave={() => onHover?.(null)}
              className={cn(
                'grid min-h-9 place-items-center rounded-md text-sm transition',
                !cell.inMonth && 'text-gray-300',
                cell.disabled && 'cursor-not-allowed text-gray-300',
                cell.inMonth &&
                  !cell.disabled &&
                  !isSelected &&
                  !inRange &&
                  'text-gray-700 hover:bg-primary-50 hover:text-primary-700',
                inRange && !isSelected && 'bg-primary-50 text-primary-700',
                isSelected && 'bg-primary-600 font-semibold text-white',
                cell.today && !isSelected && 'ring-1 ring-primary-400',
                isFocused && 'ring-2 ring-primary-500 ring-offset-1',
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
