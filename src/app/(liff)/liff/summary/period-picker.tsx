'use client';

/**
 * Period selector for the employee summary: month arrows (the original
 * behaviour) or a custom from–to range, which the customer asked for.
 *
 * Navigates with next/link Links / router.push rather than posting a form, so
 * every state is a shareable, bookmarkable URL, soft transitions stay soft,
 * and the back button works.
 */

import Link from 'next/link';
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
      <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
        <div className="flex items-center justify-between">
          {/* next/link Link, not <a> — a soft transition so scrubbing
           *  through months doesn't cost a full page reload. That's what
           *  makes the PeriodPicker `key` in page.tsx load-bearing — see
           *  page.tsx for why a soft transition needs it. */}
          <Link
            href={monthUrl(prev)}
            aria-label={labels.prevMonth}
            className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-sunken hover:text-ink-2"
          >
            ‹
          </Link>
          <p className="text-sm font-semibold text-ink-1">{monthLabel}</p>
          <Link
            href={monthUrl(next)}
            aria-label={labels.nextMonth}
            className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-sunken hover:text-ink-2"
          >
            ›
          </Link>
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
    <div className="space-y-2 rounded-xl border border-line bg-surface px-3 py-2.5">
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
        {month === null ? (
          // Genuine custom-range mode (server-resolved, no month behind it):
          // a real navigation back to month mode is required.
          // Deliberate default: if the pending range spans two months, this
          // always lands on the range's START month, not the end. `range.from`
          // is a plain string (onChange coerces a cleared field to ''), so
          // `||` — not `??` — is what actually falls back to today.
          <Link
            href={monthUrl((range.from || todayYmd).slice(0, 7))}
            className="rounded-md px-3 py-2 text-xs font-medium text-ink-2 hover:bg-surface-sunken"
          >
            {labels.backToMonthly}
          </Link>
        ) : (
          // A month is already being displayed (the user only toggled into
          // custom-entry mode locally) — this is a mode switch, not a
          // navigation. The URL never changed, so a Link back to the same
          // month would be a no-op; flip local state instead.
          <button
            type="button"
            onClick={() => setCustom(false)}
            className="rounded-md px-3 py-2 text-xs font-medium text-ink-2 hover:bg-surface-sunken"
          >
            {labels.backToMonthly}
          </button>
        )}
      </div>
    </div>
  );
}
