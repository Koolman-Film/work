'use client';

/**
 * DateField — a single-date field you can TYPE into or pick from a calendar.
 *
 * The box is a text input showing the formatted date (e.g. "12/07/2569" in
 * Thai). Typing "27/04/2537" and pressing Enter or leaving the field commits
 * it — parsed in the field's own day/month/year order, BE years understood
 * (`parseTypedDate`). Clicking the box or the calendar icon opens a
 * `CalendarMonth` popover whose header has month and year dropdowns, so a
 * date decades away is two clicks, not hundreds of ‹ presses.
 *
 * The chosen value posts through a hidden input as ISO "YYYY-MM-DD" when
 * `name` is given (form mode), or is reported via `onChange` when `value` is
 * controlled. Text that is not a real date (or falls outside min/max) is
 * refused: the field keeps its previous value and says so, rather than
 * posting something the server would reject or, worse, accept wrongly.
 */

import { useLocale } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarMonth } from '@/components/ui/calendar-month';
import {
  type DateOrder,
  isDisabled,
  parseISO,
  parseTypedDate,
  shiftMonth0,
} from '@/lib/date/be-calendar';
import type { Locale } from '@/lib/i18n/config';
import { formatShortDate, latnDigits } from '@/lib/i18n/format';
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

/** The field order formatShortDate uses for this locale, read from Intl so
 *  what the user types matches what the field shows. */
function shortDateOrder(locale: Locale): DateOrder {
  const parts = new Intl.DateTimeFormat(
    locale === 'th' ? 'th-TH-u-ca-gregory' : latnDigits(locale),
    { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' },
  )
    .formatToParts(new Date(Date.UTC(2024, 0, 15)))
    .map((p) => p.type)
    .filter((t) => t === 'day' || t === 'month' || t === 'year');
  if (parts[0] === 'year') return 'ymd';
  if (parts[0] === 'month') return 'mdy';
  return 'dmy';
}

const TYPING_HINT: Record<DateOrder, string> = {
  dmy: 'dd/mm/yyyy',
  mdy: 'mm/dd/yyyy',
  ymd: 'yyyy/mm/dd',
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
  const order = useMemo(() => shortDateOrder(locale), [locale]);

  const [internalValue, setInternalValue] = useState<string | null>(defaultValue ?? null);
  const value = isControlled ? (controlledValue ?? null) : internalValue;

  const [open, setOpen] = useState(false);
  // What the user is typing; null while not editing (the box then shows the
  // formatted value).
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const todayIso = ymd(new Date());
  const seed = (value && parseISO(value)) || parseISO(todayIso);
  const [view, setView] = useState<{ year: number; month0: number }>({
    year: seed?.year ?? new Date().getUTCFullYear(),
    month0: seed?.month0 ?? new Date().getUTCMonth(),
  });

  // Dropdown span: the bounds when given, else a century back (birth dates)
  // to a decade ahead (contract ends, future leave).
  const thisYear = Number(todayIso.slice(0, 4));
  const yearRange = {
    from: min ? Number(min.slice(0, 4)) : thisYear - 100,
    to: max ? Number(max.slice(0, 4)) : thisYear + 10,
  };

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

  function commit(iso: string | null) {
    setDraft(null);
    setInvalid(false);
    if (iso === value) return;
    if (!isControlled) setInternalValue(iso);
    onChange?.(iso);
  }

  function pick(iso: string) {
    commit(iso);
    setOpen(false);
  }

  function clear() {
    commit(null);
    setOpen(false);
  }

  /** Commit what was typed. Blank clears (unless required — then it reverts);
   *  anything unparseable or out of bounds is refused and flagged. */
  function commitDraft() {
    if (draft === null) return;
    const text = draft.trim();
    if (text === '') {
      if (required) {
        setDraft(null);
        setInvalid(false);
      } else {
        commit(null);
      }
      return;
    }
    const iso = parseTypedDate(text, order);
    if (!iso || isDisabled(iso, min, max)) {
      setDraft(null);
      setInvalid(true);
      return;
    }
    commit(iso);
    const p = parseISO(iso);
    if (p) setView({ year: p.year, month0: p.month0 });
  }

  function syncViewToValue() {
    const parsed = (value && parseISO(value)) || parseISO(todayIso);
    if (parsed) setView({ year: parsed.year, month0: parsed.month0 });
  }

  function togglePopover() {
    if (disabled) return;
    if (!open) syncViewToValue();
    setOpen((o) => !o);
  }

  function onType(text: string) {
    setDraft(text);
    setInvalid(false);
    // Follow a complete, valid date in the open calendar as it is typed.
    const iso = parseTypedDate(text, order);
    const p = iso ? parseISO(iso) : null;
    if (p) setView({ year: p.year, month0: p.month0 });
  }

  const formatted =
    value && parseISO(value) ? formatShortDate(new Date(`${value}T12:00:00Z`), locale) : '';
  const typingHint = locale === 'th' ? 'วว/ดด/ปปปป' : TYPING_HINT[order];
  const errorId = id ? `${id}-error` : undefined;

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

      <div className="relative">
        <input
          type="text"
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={draft ?? formatted}
          placeholder={placeholder ? `${placeholder} (${typingHint})` : typingHint}
          onChange={(e) => onType(e.target.value)}
          onClick={() => {
            if (!open) togglePopover();
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Commit, never submit the surrounding form from a date box.
              e.preventDefault();
              commitDraft();
              setOpen(false);
            } else if (e.key === 'Escape') {
              setDraft(null);
              setInvalid(false);
            }
          }}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          disabled={disabled}
          className={cn(
            'w-full rounded-lg border border-line-strong bg-surface py-2 pl-3 pr-9 text-sm text-ink-1 tabular-nums placeholder:text-ink-4 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
            invalid && 'border-red-500 focus:border-red-500 focus:ring-red-500',
            disabled && 'cursor-not-allowed bg-surface-muted text-ink-4',
          )}
        />
        <button
          type="button"
          onClick={togglePopover}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={locale === 'th' ? 'เปิดปฏิทิน' : 'Open calendar'}
          disabled={disabled}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-ink-4 hover:text-ink-2 disabled:cursor-not-allowed"
        >
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
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>

      {invalid && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {locale === 'th'
            ? `วันที่ไม่ถูกต้อง — พิมพ์แบบ ${typingHint} เช่น 27/04/2537`
            : `Not a valid date — type it as ${typingHint}`}
        </p>
      )}

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
            yearRange={yearRange}
          />
          {clearable && value && (
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={clear}
                className="rounded-md px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-hover-strong hover:text-ink-2"
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
