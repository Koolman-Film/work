'use client';

/**
 * Month + branch filter bar for the สปส.1-10 review page. URL-driven, no
 * local state — same rationale as employees/employee-filters.tsx and
 * reports/report-filters.tsx (shareable / bookmarkable / server re-renders
 * straight from searchParams).
 *
 * Unlike the auto-submitting report filters, this bar has an explicit submit
 * button: MonthPicker's own value only changes via its popover (no native
 * onChange to hook an auto-submit into), so a single "แสดง" button commits
 * both the month and branch selections together.
 */

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/month-picker';

type Option = { id: string; name: string };

export function SsoFilters({
  initial,
  branches,
}: {
  initial: { m: string; branchId: string };
  branches: readonly Option[];
}) {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const m = String(fd.get('m') ?? '').trim();
    const branchId = String(fd.get('branchId') ?? '').trim();
    if (m) params.set('m', m);
    if (branchId) params.set('branchId', branchId);
    const qs = params.toString();
    router.push(qs ? `/admin/filings/sso?${qs}` : '/admin/filings/sso');
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col text-xs text-ink-3">
        <span>เดือน</span>
        <MonthPicker id="m" name="m" defaultValue={initial.m} className="mt-1 w-44" />
      </div>
      <label className="flex flex-col text-xs text-ink-3">
        สาขา
        <select
          name="branchId"
          aria-label="กรองตามสาขา"
          defaultValue={initial.branchId}
          className="mt-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
        >
          <option value="">เลือกสาขา…</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit">แสดง</Button>
    </form>
  );
}
