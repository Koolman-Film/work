'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { adjacentMonths } from '@/lib/reports/period';

/** Month nav (← มิ.ย. 2569 →) + custom from–to range. Admin UI: Thai, Buddhist year (+543). */
export function PeriodPicker({
  month,
  from,
  to,
}: {
  month: string | null;
  from: string;
  to: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  function withParams(next: Record<string, string | null>): string {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    return `${pathname}?${p.toString()}`;
  }

  const current = month ?? from.slice(0, 7);
  const { prev, next } = adjacentMonths(current);
  const y = Number(current.slice(0, 4));
  const monthLabel = `${new Date(`${current}-01T00:00:00Z`).toLocaleDateString('th-TH', {
    month: 'short',
    timeZone: 'UTC',
  })} ${y + 543}`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-1">
        <Link
          href={withParams({ m: prev, from: null, to: null })}
          className="rounded px-2 py-1 text-sm text-ink-3 hover:bg-gray-50 hover:text-ink-1"
          aria-label="เดือนก่อนหน้า"
        >
          ←
        </Link>
        <span className="min-w-24 px-2 text-center text-sm font-medium text-ink-1">
          {month ? monthLabel : 'กำหนดเอง'}
        </span>
        <Link
          href={withParams({ m: next, from: null, to: null })}
          className="rounded px-2 py-1 text-sm text-ink-3 hover:bg-gray-50 hover:text-ink-1"
          aria-label="เดือนถัดไป"
        >
          →
        </Link>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const fromVal = String(fd.get('from'));
          const toVal = String(fd.get('to'));
          // Inverted ranges would silently fall back to the current month
          // server-side — cheaper to just not navigate.
          if (!fromVal || !toVal || fromVal > toVal) return;
          router.push(withParams({ from: fromVal, to: toVal, m: null }));
        }}
      >
        <input
          type="date"
          name="from"
          required
          defaultValue={from}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="text-sm text-gray-400">–</span>
        <input
          type="date"
          name="to"
          required
          defaultValue={to}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          ดูช่วงนี้
        </button>
      </form>
    </div>
  );
}
