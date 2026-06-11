'use client';

/**
 * Month picker — a date-picker-style popover for choosing a month.
 *
 * Trigger looks like an Input showing "กรกฎาคม 2569"; clicking opens a
 * calendar-like panel: ‹ year (Buddhist) › header + a 3×4 grid of Thai
 * month abbreviations. The chosen value posts through a hidden input as
 * "YYYY-MM", so server actions keep their existing contract.
 *
 * Why custom instead of <input type="month">: Safari desktop has no
 * native month picker (renders bare text), and natives show Gregorian
 * years while the whole admin UI speaks พ.ศ.
 */

import { useEffect, useRef, useState } from 'react';
import { monthLabelTh } from '@/lib/format';
import { cn } from '@/lib/utils';

const MONTH_TH_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

function ym(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}

type Props = {
  id: string;
  name: string;
  /** Initial value "YYYY-MM". */
  defaultValue: string;
  /** Inclusive bounds "YYYY-MM" — months outside render disabled. */
  min?: string;
  max?: string;
  className?: string;
};

export function MonthPicker({ id, name, defaultValue, min, max, className }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(Number(defaultValue.slice(0, 4)));
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Esc — same conventions as the Dialog primitive.
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

  const disabled = (m: string) => Boolean((min && m < min) || (max && m > max));

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <input type="hidden" name={name} value={value} />

      <button
        type="button"
        id={id}
        onClick={() => {
          setViewYear(Number(value.slice(0, 4)));
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <span>{monthLabelTh(value)}</span>
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
        <div
          role="dialog"
          aria-label="เลือกเดือน"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
        >
          {/* Year navigator */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              aria-label="ปีก่อนหน้า"
              className="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              ‹
            </button>
            <span className="font-display text-sm font-bold text-ink-1">{viewYear + 543}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              aria-label="ปีถัดไป"
              className="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              ›
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1">
            {MONTH_TH_SHORT.map((label, idx) => {
              const m = ym(viewYear, idx);
              const isSelected = m === value;
              const isDisabled = disabled(m);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    setValue(m);
                    setOpen(false);
                  }}
                  className={cn(
                    'rounded-lg px-2 py-2 text-sm transition',
                    isSelected
                      ? 'bg-primary-600 font-semibold text-white'
                      : isDisabled
                        ? 'cursor-not-allowed text-gray-300'
                        : 'text-gray-700 hover:bg-primary-50 hover:text-primary-700',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
