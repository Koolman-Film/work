'use client';

/**
 * Approvals inbox filter bar — URL-driven, no local state.
 *
 * Mirrors `audit-filters.tsx`'s pattern (itself modeled on
 * `employee-filters.tsx`): the form strips empty fields and pushes a
 * minimal querystring, so the Server Component page re-renders the inbox
 * directly from searchParams.
 *
 * Like the audit filters, this bar does NOT auto-submit on change — type,
 * branch, and the employee-name search are commonly combined before
 * running a query, so a single explicit "กรอง" submit avoids firing a
 * fetch per keystroke/selection.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type ApprovalsFiltersProps = {
  initial: { type?: string; branchId?: string; q?: string };
  branches: { id: string; name: string }[];
};

const TYPES = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'leave', label: 'ลา' },
  { value: 'advance', label: 'เบิก' },
  { value: 'disputed', label: 'ลงเวลา' },
];

const selectClassName =
  'max-w-[200px] rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100';
const inputClassName =
  'rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100';

export function ApprovalsFilters({ initial, branches }: ApprovalsFiltersProps) {
  const router = useRouter();

  // Strip empty fields from the URL before navigation, so the address bar
  // doesn't gain a trail of ?type=&branchId=&q= on every submit.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : '';
      if (value) params.set(k, value);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/approvals?${qs}` : '/admin/approvals');
  }

  const hasAnyFilter = !!initial.type || !!initial.branchId || !!initial.q;

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          ประเภท
          <select name="type" defaultValue={initial.type ?? ''} className={selectClassName}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-3">
          สาขา
          <select name="branchId" defaultValue={initial.branchId ?? ''} className={selectClassName}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-3">
          ค้นหา
          <input
            type="search"
            name="q"
            defaultValue={initial.q ?? ''}
            placeholder="ค้นหาชื่อพนักงาน"
            className={inputClassName}
          />
        </label>

        <Button type="submit" variant="secondary" size="md">
          กรอง
        </Button>
      </div>

      {hasAnyFilter && (
        <div className="flex justify-end text-xs text-ink-3">
          <Link
            href="/admin/approvals"
            className="font-medium text-primary-700 hover:text-primary-800"
          >
            ✕ ล้างทั้งหมด
          </Link>
        </div>
      )}
    </form>
  );
}
