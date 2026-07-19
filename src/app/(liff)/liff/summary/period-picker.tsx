'use client';

/**
 * Period selector for the employee summary: month arrows (the original
 * behaviour) or a custom from–to range, which the customer asked for.
 *
 * Navigates with plain hrefs / router.push rather than posting a form, so
 * every state is a shareable, bookmarkable URL and the back button works.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateRangeField } from '@/components/ui/date-range-field';
import { monthUrl, rangeUrl } from './period-url';

type Props = {
  /** null when a custom range is active. */
  month: string | null;
  monthLabel: string;
  prev: string;
  next: string;
  from: string;
  to: string;
  todayYmd: string;
  labels: {
    prevMonth: string;
    nextMonth: string;
    customRange: string;
    backToMonthly: string;
    applyRange: string;
  };
};

export function PeriodPicker({ month, monthLabel, prev, next, from, to, todayYmd, labels }: Props) {
  const router = useRouter();
  const [custom, setCustom] = useState(month === null);
  const [range, setRange] = useState<{ from: string; to: string }>({ from, to });

  if (!custom) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <div className="flex items-center justify-between">
          <a
            href={monthUrl(prev)}
            aria-label={labels.prevMonth}
            className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            ‹
          </a>
          <p className="text-sm font-semibold text-gray-900">{monthLabel}</p>
          <a
            href={monthUrl(next)}
            aria-label={labels.nextMonth}
            className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            ›
          </a>
        </div>
        <button
          type="button"
          onClick={() => setCustom(true)}
          className="mt-2 w-full rounded-md py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
        >
          {labels.customRange}
        </button>
      </div>
    );
  }

  const target = rangeUrl(range.from, range.to);

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <DateRangeField
        value={range}
        onChange={(v) => setRange({ from: v.from ?? '', to: v.to ?? '' })}
        max={todayYmd}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={target === null}
          onClick={() => target && router.push(target)}
          className="flex-1 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {labels.applyRange}
        </button>
        <a
          href={monthUrl((month ?? range.from ?? todayYmd).slice(0, 7))}
          className="rounded-md px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          {labels.backToMonthly}
        </a>
      </div>
    </div>
  );
}
