'use client';

/**
 * Combobox — a styled, searchable select that also lets the user add a value
 * not in the list. Matches the MonthPicker's visual language (button trigger +
 * popover panel, click-outside / Esc, primary-accent options) so it sits
 * consistently among the other form controls.
 *
 * The chosen value posts through a hidden input, so server actions keep their
 * existing string contract (same as MonthPicker).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  id?: string;
  name: string;
  /** Initial selected value. */
  defaultValue?: string;
  /** Selectable options (presets + history). */
  options: readonly string[];
  placeholder?: string;
  /** Allow committing a free-typed value not in `options`. Default true. */
  allowCustom?: boolean;
  maxLength?: number;
  className?: string;
};

export function Combobox({
  id,
  name,
  defaultValue = '',
  options,
  placeholder = 'เลือกหรือพิมพ์…',
  allowCustom = true,
  maxLength,
  className,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Close on outside click / Esc — same conventions as MonthPicker + Dialog.
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

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : [...options];
  }, [options, trimmed]);

  // Offer a free-add row when the query is non-empty and not already an option.
  const showCustom = allowCustom && trimmed.length > 0 && !options.includes(trimmed);
  // Rows = filtered options, then (optionally) the custom row.
  const rowCount = filtered.length + (showCustom ? 1 : 0);

  function commit(next: string) {
    setValue(next);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, rowCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx < filtered.length) {
        const opt = filtered[activeIdx];
        if (opt) commit(opt);
      } else if (showCustom) {
        commit(trimmed);
      }
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <input type="hidden" name={name} value={value} />

      <button
        type="button"
        id={id}
        onClick={() => {
          setQuery('');
          setActiveIdx(0);
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      >
        <span className={cn('truncate', value ? 'text-gray-900' : 'text-gray-400')}>
          {value || placeholder}
        </span>
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
          className={cn('shrink-0 text-gray-400 transition', open && 'rotate-180')}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {/* Search box */}
          <input
            ref={searchRef}
            type="text"
            value={query}
            maxLength={maxLength}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="ค้นหา หรือพิมพ์เพื่อเพิ่มใหม่…"
            className="mb-1.5 block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />

          {/* Options */}
          <div role="listbox" aria-labelledby={listId} className="max-h-56 overflow-auto">
            {filtered.map((opt, i) => {
              const isSelected = opt === value;
              const isActive = i === activeIdx;
              return (
                <div key={opt}>
                  <button
                    type="button"
                    onClick={() => commit(opt)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition',
                      isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700',
                      isSelected && 'font-semibold',
                    )}
                  >
                    <span className="truncate">{opt}</span>
                    {isSelected && <span className="ml-2 shrink-0 text-primary-600">✓</span>}
                  </button>
                </div>
              );
            })}

            {showCustom && (
              <div>
                <button
                  type="button"
                  onClick={() => commit(trimmed)}
                  onMouseEnter={() => setActiveIdx(filtered.length)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-sm transition',
                    activeIdx === filtered.length
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-700',
                  )}
                >
                  <span className="text-primary-600">+</span>
                  <span className="truncate">
                    เพิ่ม “<span className="font-medium">{trimmed}</span>”
                  </span>
                </button>
              </div>
            )}

            {rowCount === 0 && (
              <div className="px-2.5 py-2 text-center text-sm text-gray-400">ไม่พบรายการ</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
