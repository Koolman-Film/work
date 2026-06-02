'use client';

/**
 * Employee list filter bar — URL-driven, no local state.
 *
 * Why URL-driven instead of React state:
 *   - Filter views are shareable / bookmarkable / back-button-friendly.
 *   - Server Component re-renders the table directly from searchParams,
 *     no Suspense gymnastics.
 *
 * Submit behaviour is hybrid:
 *   - Dropdowns auto-submit on change (instant filter)
 *   - Search box submits on Enter (avoids spam-firing on every keystroke
 *     while typing a Thai-keyboard query; debouncing felt over-engineered
 *     for ≤100 employees)
 *   - "ล้างทั้งหมด" link clears all filters with a single click
 *
 * Empty fields are stripped from the URL by the form before submit, so
 * the resulting URL is always minimal (e.g. /admin/employees?q=ตงค์ rather
 * than ?q=ตงค์&branchId=&departmentId=&status=).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';

type Option = { id: string; name: string };

type Props = {
  initial: {
    q: string;
    branchId: string;
    departmentId: string;
    status: string;
  };
  branches: readonly Option[];
  departments: readonly Option[];
  /** Total count of rows matching the *current* filter (server-computed). */
  matchedCount: number;
};

const STATUS_OPTIONS = [
  { value: '', label: 'ปัจจุบัน (ไม่รวมพ้นสภาพ)' },
  { value: 'active', label: 'ปกติ' },
  { value: 'probation', label: 'ทดลองงาน' },
  { value: 'archived', label: 'พ้นสภาพ' },
] as const;

export function EmployeeFilters({ initial, branches, departments, matchedCount }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  // Strip empty fields from the URL before navigation, so the address bar
  // doesn't gain a trail of ?q=&branchId=&… on every submit.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : '';
      if (value) params.set(k, value);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/employees?${qs}` : '/admin/employees');
  }

  const hasAnyFilter =
    initial.q !== '' ||
    initial.branchId !== '' ||
    initial.departmentId !== '' ||
    initial.status !== '';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search box — submits on Enter */}
        <div className="min-w-[240px] flex-1">
          <input
            type="text"
            name="q"
            placeholder="ค้นหา ชื่อ / นามสกุล / ชื่อเล่น"
            defaultValue={initial.q}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>

        {/* Branch dropdown — auto-submits */}
        <FilterSelect
          name="branchId"
          defaultValue={initial.branchId}
          ariaLabel="กรองตามสาขา"
          onChange={() => formRef.current?.requestSubmit()}
          options={[{ id: '', name: 'สาขาทั้งหมด' }, ...branches]}
        />

        {/* Department dropdown — auto-submits */}
        <FilterSelect
          name="departmentId"
          defaultValue={initial.departmentId}
          ariaLabel="กรองตามแผนก"
          onChange={() => formRef.current?.requestSubmit()}
          options={[{ id: '', name: 'แผนกทั้งหมด' }, ...departments]}
        />

        {/* Status dropdown — auto-submits */}
        <select
          name="status"
          aria-label="กรองตามสถานะ"
          defaultValue={initial.status}
          onChange={() => formRef.current?.requestSubmit()}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Result count + clear button — only render the clear link when
          something is actually filtered, to avoid visual noise. */}
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>
          พบ <strong className="font-semibold text-ink-1 tabular-nums">{matchedCount}</strong> คน
          {hasAnyFilter && ' (กรองแล้ว)'}
        </span>
        {hasAnyFilter && (
          <Link
            href="/admin/employees"
            className="font-medium text-primary-700 hover:text-primary-800"
          >
            ✕ ล้างทั้งหมด
          </Link>
        )}
      </div>
    </form>
  );
}

function FilterSelect({
  name,
  defaultValue,
  ariaLabel,
  onChange,
  options,
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
  onChange: () => void;
  options: readonly Option[];
}) {
  return (
    <select
      name={name}
      aria-label={ariaLabel}
      defaultValue={defaultValue}
      onChange={onChange}
      className="max-w-[200px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
    >
      {options.map((opt) => (
        <option key={opt.id || 'all'} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}
