'use client';

/**
 * DateField — a single-date picker field.
 *
 * Trigger looks like an Input showing the formatted date (e.g. "12/07/2569"
 * in Thai locale); clicking opens a `CalendarMonth` popover (the shared
 * single-month grid also used by DateRangeField) to pick a day. The chosen
 * value posts through a hidden input as ISO "YYYY-MM-DD" when `name` is
 * given (form mode), or is reported via `onChange` when `value` is
 * controlled — mirrors `month-picker.tsx`'s open/outside-click/hidden-input
 * pattern so this reads as a sibling component.
 */

import { useLocale } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CalendarMonth } from '@/components/ui/calendar-month';
import { parseISO, shiftMonth0 } from '@/lib/date/be-calendar';
import type { Locale } from '@/lib/i18n/config';
import { formatShortDate } from '@/lib/i18n/format';
import { ymd } from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';

type Props = {
  name?: string;
  /** Initial value "YYYY-MM-DD" — used only when uncontrolled. */
  defaultValue?: string;
  /** Controlled value "YYYY-MM-DD" | null. Pass `undefined` to stay uncontrolled. */
  value?: string | null;
  onChange?: (iso: string | null) => void;
  /** Inclusive bounds "YYYY-MM-DD" — days outside render disabled. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** Show a "clear" affordance when a value is set. */
  clearable?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
};

export function DateField({
  name,
  defaultValue,
  value: controlledValue,
  onChange,
  min,
  max,
  required,
  disabled,
  clearable,
  placeholder,
  id,
  'aria-label': ariaLabel,
  className,
}: Props) {
  const locale = useLocale() as Locale;
  const isControlled = controlledValue !== undefined;

  const [internalValue, setInternalValue] = useState<string | null>(defaultValue ?? null);
  const value = isControlled ? (controlledValue ?? null) : internalValue;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const todayIso = ymd(new Date());
  const seed = (value && parseISO(value)) || parseISO(todayIso);
  const [view, setView] = useState<{ year: number; month0: number }>({
    year: seed?.year ?? new Date().getUTCFullYear(),
    month0: seed?.month0 ?? new Date().getUTCMonth(),
  });

  // Close on outside click / Esc — same conventions as month-picker.tsx.
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

  function pick(iso: string) {
    if (!isControlled) setInternalValue(iso);
    setOpen(false);
    onChange?.(iso);
  }

  function clear() {
    if (!isControlled) setInternalValue(null);
    setOpen(false);
    onChange?.(null);
  }

  function openPopover() {
    if (disabled) return;
    const parsed = (value && parseISO(value)) || parseISO(todayIso);
    if (parsed) setView({ year: parsed.year, month0: parsed.month0 });
    setOpen((o) => !o);
  }

  const label =
    value && parseISO(value)
      ? formatShortDate(new Date(`${value}T12:00:00Z`), locale)
      : (placeholder ?? '');

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {name && (
        <input
          type="hidden"
          name={name}
          value={value ?? ''}
          required={required}
          disabled={disabled}
        />
      )}

      <button
        type="button"
        id={id}
        onClick={openPopover}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
          disabled && 'cursor-not-allowed bg-gray-50 text-gray-400',
          !value && 'text-gray-400',
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
          className="shrink-0 text-gray-400"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label="เลือกวันที่" className="absolute left-0 top-full z-30 mt-1">
          <CalendarMonth
            viewYear={view.year}
            viewMonth0={view.month0}
            selected={value}
            min={min}
            max={max}
            today={todayIso}
            onPick={pick}
            onNavMonth={(delta) => setView((v) => shiftMonth0(v.year, v.month0, delta))}
          />
          {clearable && value && (
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={clear}
                className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                ล้าง
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
