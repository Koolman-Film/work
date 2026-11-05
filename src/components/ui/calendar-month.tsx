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
import { beYear, buildDayGrid, type ISODate, isDisabled, parseISO } from '@/lib/date/be-calendar';
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
  /**
   * Inclusive Gregorian year span for month/year dropdowns in the header.
   * Without it the header is the plain label — fine for a range picker that
   * lives near today, useless for a birth date thirty years back, which is
   * 360 clicks of ‹ away.
   */
  yearRange?: { from: number; to: number };
};

/** Short month names for the header dropdown, in the reader's language. */
function monthNames(locale: Locale): string[] {
  const fmt = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : locale, {
    month: 'short',
    timeZone: 'UTC',
  });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(Date.UTC(2024, m, 15))));
}

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
  yearRange,
}: Props) {
  const locale = useLocale() as Locale;
  const [focusedIso, setFocusedIso] = useState<ISODate>(selected ?? today);

  // Keep focus anchored to the selected date when it changes externally
  // (e.g. parent field resets it), so keyboard nav resumes from there.
  useEffect(() => {
    setFocusedIso(selected ?? today);
  }, [selected, today]);

  // Re-sync the focus ring when the view month changes without focus
  // moving in lockstep (PageUp/PageDown and the ‹ › nav buttons only tell
  // the parent to change viewYear/viewMonth0 — they don't touch
  // focusedIso). Without this, the ring can end up on a day that's no
  // longer part of the visible month. Land on the same day-of-month,
  // clamped to the new month's length (arrow-key nav already sets
  // focusedIso into the new month itself, so this is a no-op then).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-sync only on view-month change (reading focusedIso here is fine — including it would fight arrow-key nav, which sets it directly).
  useEffect(() => {
    const parsed = parseISO(focusedIso);
    if (parsed && parsed.year === viewYear && parsed.month0 === viewMonth0) return;
    const day = parsed?.day ?? 1;
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth0 + 1, 0)).getUTCDate();
    const mm = String(viewMonth0 + 1).padStart(2, '0');
    const dd = String(Math.min(day, daysInMonth)).padStart(2, '0');
    setFocusedIso(`${viewYear}-${mm}-${dd}`);
  }, [viewYear, viewMonth0]);

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
        if (!isDisabled(focusedIso, min, max)) onPick(focusedIso);
        break;
      default:
        break;
    }
  }

  return (
    <div className="w-64 rounded-xl border border-line bg-surface p-3 text-left shadow-lg">
      {/* Header: ‹ month label › */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavMonth(-1)}
          aria-label={locale === 'th' ? 'เดือนก่อนหน้า' : 'Previous month'}
          className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-hover-strong hover:text-ink-2"
        >
          ‹
        </button>
        {yearRange ? (
          <MonthYearSelects
            locale={locale}
            viewYear={viewYear}
            viewMonth0={viewMonth0}
            yearRange={yearRange}
            onJump={(year, month0) => onNavMonth((year - viewYear) * 12 + (month0 - viewMonth0))}
          />
        ) : (
          <span className="font-display text-sm font-bold text-ink-1">{monthLabel}</span>
        )}
        <button
          type="button"
          onClick={() => onNavMonth(1)}
          aria-label={locale === 'th' ? 'เดือนถัดไป' : 'Next month'}
          className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-hover-strong hover:text-ink-2"
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
              i === 0 ? 'text-red-600' : 'text-ink-3',
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
          const dateLabel = formatShortDate(new Date(`${cell.iso}T12:00:00Z`), locale);

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
                !cell.inMonth && 'text-ink-4',
                cell.disabled && 'cursor-not-allowed text-ink-4',
                cell.inMonth &&
                  !cell.disabled &&
                  !isSelected &&
                  !inRange &&
                  'text-ink-2 hover:bg-primary-50 hover:text-primary-700',
                inRange && !isSelected && 'bg-primary-50 text-primary-700',
                isSelected && 'bg-brand-solid font-semibold text-white',
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

/**
 * Month + year dropdowns for the header. They only ever ask the parent to
 * move the view (through the same onNavMonth delta the ‹ › buttons use), so
 * the parent keeps sole ownership of view state. Years list newest first —
 * the common jump is backwards, to a birth year — and always include the
 * year on show, even when it falls outside the span.
 */
function MonthYearSelects({
  locale,
  viewYear,
  viewMonth0,
  yearRange,
  onJump,
}: {
  locale: Locale;
  viewYear: number;
  viewMonth0: number;
  yearRange: { from: number; to: number };
  onJump: (year: number, month0: number) => void;
}) {
  const from = Math.min(yearRange.from, viewYear);
  const to = Math.max(yearRange.to, viewYear);
  const years = Array.from({ length: to - from + 1 }, (_, i) => to - i);
  const months = monthNames(locale);
  // Height inline: the element-level select rule in globals.css (38px, to
  // match Input) is unlayered and would beat a utility class.
  const cls = 'rounded-md border border-line bg-surface px-2 text-sm font-semibold text-ink-1';
  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={locale === 'th' ? 'เดือน' : 'Month'}
        value={viewMonth0}
        onChange={(e) => onJump(viewYear, Number(e.target.value))}
        className={cls}
        style={{ height: 30 }}
      >
        {months.map((m, i) => (
          <option key={m} value={i}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={locale === 'th' ? 'ปี' : 'Year'}
        value={viewYear}
        onChange={(e) => onJump(Number(e.target.value), viewMonth0)}
        className={cls}
        style={{ height: 30 }}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {locale === 'th' ? beYear(y) : y}
          </option>
        ))}
      </select>
    </div>
  );
}
