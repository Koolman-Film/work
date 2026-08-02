'use client';

/**
 * DateRangeField — a from/to date-range picker field.
 *
 * Trigger looks like an Input showing "from – to" (e.g. "1/07/2569 –
 * 5/07/2569" in Thai locale); clicking opens a `CalendarMonth` popover (the
 * shared single-month grid also used by DateField). The user clicks a start
 * day, then an end day (with a hover preview tinting the pending range in
 * between); a third click starts a fresh range. Values post through two
 * hidden inputs as ISO "YYYY-MM-DD" when `fromName`/`toName` are given (form
 * mode), or are reported via `onChange` when `value` is controlled — mirrors
 * date-field.tsx's open/outside-click/hidden-input pattern so this reads as
 * a sibling component.
 */

import { useLocale } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CalendarMonth } from '@/components/ui/calendar-month';
import { clampRange, parseISO, shiftMonth0 } from '@/lib/date/be-calendar';
import type { Locale } from '@/lib/i18n/config';
import { formatShortDate } from '@/lib/i18n/format';
import { ymd } from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';

type DateRange = { from: string | null; to: string | null };

type Props = {
  fromName?: string;
  toName?: string;
  /** Initial values "YYYY-MM-DD" — used only when uncontrolled. */
  defaultFrom?: string;
  defaultTo?: string;
  /** Controlled value. Pass `undefined` to stay uncontrolled. */
  value?: DateRange;
  onChange?: (range: DateRange) => void;
  /** Inclusive bounds "YYYY-MM-DD" — days outside render disabled. */
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
};

export function DateRangeField({
  fromName,
  toName,
  defaultFrom,
  defaultTo,
  value: controlledValue,
  onChange,
  min,
  max,
  disabled,
  placeholder,
  id,
  'aria-label': ariaLabel,
  className,
}: Props) {
  const locale = useLocale() as Locale;
  const isControlled = controlledValue !== undefined;

  const [internalFrom, setInternalFrom] = useState<string | null>(defaultFrom ?? null);
  const [internalTo, setInternalTo] = useState<string | null>(defaultTo ?? null);
  const from = isControlled ? (controlledValue?.from ?? null) : internalFrom;
  const to = isControlled ? (controlledValue?.to ?? null) : internalTo;

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<'idle' | 'start'>('idle');
  const [hover, setHover] = useState<string | null>(null);
  // Pending first-click anchor for the range being picked. Tracked
  // independently of controlled/uncontrolled `from` so the second click can
  // always read the true anchor — in controlled mode `from` is derived from
  // the `value` prop and doesn't advance until the parent re-renders with the
  // committed range, so relying on it alone would collapse the range.
  const [anchor, setAnchor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const todayIso = ymd(new Date());
  const seed = (from && parseISO(from)) || parseISO(todayIso);
  const [view, setView] = useState<{ year: number; month0: number }>({
    year: seed?.year ?? new Date().getUTCFullYear(),
    month0: seed?.month0 ?? new Date().getUTCMonth(),
  });

  // Close on outside click / Esc — same conventions as date-field.tsx.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function commit(range: DateRange) {
    if (!isControlled) {
      setInternalFrom(range.from);
      setInternalTo(range.to);
    }
    onChange?.(range);
  }

  function pick(iso: string) {
    if (picking === 'idle') {
      setAnchor(iso);
      if (!isControlled) {
        setInternalFrom(iso);
        setInternalTo(null);
      }
      setHover(null);
      setPicking('start');
      return;
    }

    const range = clampRange(anchor ?? iso, iso);
    setPicking('idle');
    setHover(null);
    setAnchor(null);
    setOpen(false);
    commit(range);
  }

  function openPopover() {
    if (disabled) return;
    const parsed = (from && parseISO(from)) || parseISO(todayIso);
    if (parsed) setView({ year: parsed.year, month0: parsed.month0 });
    setPicking('idle');
    setHover(null);
    setAnchor(null);
    setOpen((o) => !o);
  }

  function fmt(iso: string): string | null {
    return parseISO(iso) ? formatShortDate(new Date(`${iso}T12:00:00Z`), locale) : null;
  }

  const fromLabel = from ? fmt(from) : null;
  const toLabel = to ? fmt(to) : null;
  const label = fromLabel && toLabel ? `${fromLabel} – ${toLabel}` : (placeholder ?? '');

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {fromName && <input type="hidden" name={fromName} value={from ?? ''} disabled={disabled} />}
      {toName && <input type="hidden" name={toName} value={to ?? ''} disabled={disabled} />}

      <button
        type="button"
        id={id}
        onClick={openPopover}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-sm text-ink-1 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
          disabled && 'cursor-not-allowed bg-surface-muted text-ink-4',
          !(from && to) && 'text-ink-4',
        )}
      >
        <span>{label}</span>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-4"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label="เลือกช่วงวันที่" className="absolute left-0 top-full z-30 mt-1">
          <CalendarMonth
            viewYear={view.year}
            viewMonth0={view.month0}
            rangeFrom={picking === 'start' ? (anchor ?? from) : from}
            rangeTo={picking === 'start' ? hover : to}
            hover={hover}
            onHover={setHover}
            min={min}
            max={max}
            today={todayIso}
            onPick={pick}
            onNavMonth={(delta) => setView((v) => shiftMonth0(v.year, v.month0, delta))}
          />
        </div>
      )}
    </div>
  );
}
