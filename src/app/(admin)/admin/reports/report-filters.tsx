'use client';

/**
 * Branch + department (+ optional name search) filter bar for the report
 * tabs and the payroll run page. URL-driven, no local state — same rationale
 * as employees/employee-filters.tsx (shareable / bookmarkable / server
 * re-renders straight from searchParams).
 *
 * Path-agnostic via usePathname(), so one component serves every report tab
 * and /admin/payroll. The active period (`m` / `from` / `to`) is preserved
 * across every navigation, so picking a branch never resets the month.
 *
 * Submit behaviour matches the employee filter bar: dropdowns auto-submit on
 * change; the search box submits on Enter; "ล้างตัวกรอง" clears branch /
 * department / q while keeping the period.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef } from 'react';

type Option = { id: string; name: string };

type Props = {
  /** Active period — preserved on every filter navigation. */
  period: { m?: string; from?: string; to?: string };
  branchId: string;
  departmentId: string;
  q: string;
  branches: readonly Option[];
  departments: readonly Option[];
  /** Render the name-search box (reports yes, payroll no). */
  showSearch?: boolean;
};

export function ReportFilters({
  period,
  branchId,
  departmentId,
  q,
  branches,
  departments,
  showSearch = true,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  /** Period params that ride along on every navigation. */
  function periodParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (period.m) p.set('m', period.m);
    if (period.from) p.set('from', period.from);
    if (period.to) p.set('to', period.to);
    return p;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = periodParams();
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : '';
      if (value) params.set(k, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const clearHref = (() => {
    const qs = periodParams().toString();
    return qs ? `${pathname}?${qs}` : pathname;
  })();

  const hasFilter = branchId !== '' || departmentId !== '' || q !== '';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <FilterSelect
        name="branchId"
        defaultValue={branchId}
        ariaLabel="กรองตามสาขา"
        onChange={() => formRef.current?.requestSubmit()}
        options={[{ id: '', name: 'สาขาทั้งหมด' }, ...branches]}
      />
      <FilterSelect
        name="departmentId"
        defaultValue={departmentId}
        ariaLabel="กรองตามแผนก"
        onChange={() => formRef.current?.requestSubmit()}
        options={[{ id: '', name: 'แผนกทั้งหมด' }, ...departments]}
      />
      {showSearch && (
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="ค้นหาชื่อพนักงาน…"
          className="w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 sm:w-56"
        />
      )}
      {hasFilter && (
        <Link
          href={clearHref}
          className="px-1 text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          ✕ ล้างตัวกรอง
        </Link>
      )}
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
