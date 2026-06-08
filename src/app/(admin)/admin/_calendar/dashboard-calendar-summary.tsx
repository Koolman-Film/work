/**
 * Compact dashboard calendar summary.
 *
 * Replaces the full month grid on /admin with a short agenda of the next few
 * upcoming leave + holiday entries this month, plus a link to the full
 * /admin/calendar page. Pure server component — no interactivity, no client JS.
 */

import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { TeamCalendarData } from '@/lib/leave/team-calendar-shape';

/** How many agenda rows to show before deferring to the full calendar page. */
const MAX_ITEMS = 5;

type AgendaItem = {
  key: string;
  /** YYYY-MM-DD used only for chronological sort. */
  sortDate: string;
  dateLabel: string;
  kind: 'holiday' | 'leave';
  text: string;
};

/** Format a YYYY-MM-DD (UTC-midnight semantics) as a short Thai day, e.g. "8 มิ.ย.". */
function fmtDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function fmtRange(start: string, end: string): string {
  return start === end ? fmtDay(start) : `${fmtDay(start)}–${fmtDay(end)}`;
}

export function DashboardCalendarSummary({
  data,
  todayYmd,
}: {
  data: TeamCalendarData;
  todayYmd: string;
}) {
  const holidayItems: AgendaItem[] = data.holidays
    .filter((h) => h.date >= todayYmd)
    .map((h) => ({
      key: `h:${h.date}:${h.name}`,
      sortDate: h.date,
      dateLabel: fmtDay(h.date),
      kind: 'holiday',
      text: h.name,
    }));

  // Ongoing or upcoming leave (ended-in-the-past entries drop off). Ongoing
  // ones sort to "today" so they surface at the top alongside what's next.
  const leaveItems: AgendaItem[] = data.entries
    .filter((e) => e.endDate >= todayYmd)
    .map((e) => ({
      key: `l:${e.leaveRequestId}`,
      sortDate: e.startDate < todayYmd ? todayYmd : e.startDate,
      dateLabel: fmtRange(e.startDate, e.endDate),
      kind: 'leave',
      text: `${e.shortLabel} · ${e.leaveTypeName}`,
    }));

  const items = [...holidayItems, ...leaveItems]
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .slice(0, MAX_ITEMS);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>ปฏิทินงาน</CardTitle>
        <Link
          href="/admin/calendar"
          className="text-xs font-medium text-primary-700 hover:text-primary-800"
        >
          ดูทั้งหมด →
        </Link>
      </CardHeader>
      <CardBody className="!p-0">
        {items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-3">ไม่มีวันลาหรือวันหยุดที่จะถึงในเดือนนี้</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Pill variant={it.kind === 'holiday' ? 'neutral' : 'leave'}>
                    {it.kind === 'holiday' ? 'วันหยุด' : 'ลา'}
                  </Pill>
                  <span className="truncate text-sm text-ink-1">{it.text}</span>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-ink-4">{it.dateLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
