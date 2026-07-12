'use client';

/**
 * Audit log filter bar — URL-driven, no local state.
 *
 * Mirrors `employee-filters.tsx`'s pattern: the form strips empty fields
 * and pushes a minimal querystring, so the Server Component page re-renders
 * the log directly from searchParams.
 *
 * Unlike the employee filters, this bar does NOT auto-submit on change —
 * date inputs and the actor/action/entity dropdowns are commonly combined
 * before running a query, so a single explicit "กรอง" submit avoids firing
 * a fetch per keystroke/selection.
 *
 * Filter changes always reset keyset pagination: `cursor` is never read
 * from the form and is therefore dropped from the resulting URL.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DateRangeField } from '@/components/ui/date-range-field';
import { ACTION_LABELS, ENTITY_TYPE_LABELS } from '@/lib/audit/labels';

type AuditFiltersProps = {
  initial: {
    actor?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  actors: { id: string; label: string }[];
};

const selectClassName =
  'max-w-[200px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100';

export function AuditFilters({ initial, actors }: AuditFiltersProps) {
  const router = useRouter();

  // Strip empty fields from the URL before navigation, and never carry
  // `cursor` — filter changes reset keyset pagination.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : '';
      if (value) params.set(k, value);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/audit?${qs}` : '/admin/audit');
  }

  const hasAnyFilter =
    !!initial.actor ||
    !!initial.action ||
    !!initial.entityType ||
    !!initial.dateFrom ||
    !!initial.dateTo;

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          ผู้กระทำ
          <select name="actor" defaultValue={initial.actor ?? ''} className={selectClassName}>
            <option value="">ทั้งหมด</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-3">
          การกระทำ
          <select name="action" defaultValue={initial.action ?? ''} className={selectClassName}>
            <option value="">ทั้งหมด</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-3">
          ประเภทรายการ
          <select
            name="entityType"
            defaultValue={initial.entityType ?? ''}
            className={selectClassName}
          >
            <option value="">ทั้งหมด</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-xs text-ink-3">
          <span>ช่วงวันที่</span>
          <DateRangeField
            fromName="dateFrom"
            toName="dateTo"
            defaultFrom={initial.dateFrom || undefined}
            defaultTo={initial.dateTo || undefined}
          />
        </div>

        <Button type="submit" variant="secondary" size="md">
          กรอง
        </Button>
      </div>

      {hasAnyFilter && (
        <div className="flex justify-end text-xs text-ink-3">
          <Link href="/admin/audit" className="font-medium text-primary-700 hover:text-primary-800">
            ✕ ล้างทั้งหมด
          </Link>
        </div>
      )}
    </form>
  );
}
