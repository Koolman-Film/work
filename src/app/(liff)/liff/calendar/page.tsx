/**
 * /liff/calendar — team leave calendar (employee-facing).
 *
 * Per requirement.docx §1 ("ดูปฏิทินคนลาในทีม") and
 * docs/v2/build-plan.md:189. Read-only month view of who in the same
 * branch (or assigned branches) is on leave. Tap a day → see the list
 * of people on leave that day below the grid.
 *
 * Month navigation via search params: `?ym=YYYY-MM`. Defaults to current
 * Bangkok-time month. Prev/next links rebuild the URL — no client
 * mutation needed, so the page stays a fast SSR render.
 *
 * Why a Server Component drives the data fetch + a Client Component
 * handles the day-tap state: the calendar grid is a static computation
 * given (entries, holidays, month) — perfect for SSR. The "which day
 * did the user tap" state is client-local and ephemeral, so a thin
 * Client Component wraps it without dragging the data fetch onto the
 * browser.
 */

import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/require-role';
import { getTeamCalendarData } from '@/lib/leave/team-calendar';
import {
  buildMonthGrid,
  currentMonthYM,
  parseMonth,
  shiftMonth,
} from '@/lib/leave/team-calendar-shape';
import { CalendarGrid } from './calendar-grid';

type SearchParams = Promise<{ ym?: string }>;

export default async function LiffCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  const { ym } = await searchParams;
  // Validate `ym` from the URL. If it's missing or malformed, fall back
  // silently to the current month — never 404 over a query-string typo.
  const requestedYm = ym ?? currentMonthYM();
  const parsed = parseMonth(requestedYm) ?? parseMonth(currentMonthYM());
  if (!parsed) {
    // Defensive: should be impossible since currentMonthYM produces a
    // valid YYYY-MM, but guard against future refactors of that helper.
    throw new Error('Could not parse current month — date system broken?');
  }

  const { entries, holidays } = await getTeamCalendarData({
    viewerEmployeeId: employee.id,
    monthStart: parsed.start,
    monthEnd: parsed.end,
  });

  const grid = buildMonthGrid(parsed.year, parsed.month0);

  // Header label like "พฤษภาคม 2569" (Thai Buddhist calendar year).
  const monthName = format(parsed.start, 'MMMM', { locale: th });
  const thaiYear = parsed.year + 543;
  const monthLabel = `${monthName} ${thaiYear}`;

  const prevYm = shiftMonth(`${parsed.year}-${String(parsed.month0 + 1).padStart(2, '0')}`, -1);
  const nextYm = shiftMonth(`${parsed.year}-${String(parsed.month0 + 1).padStart(2, '0')}`, 1);
  const todayYm = currentMonthYM();

  return (
    <main className="mx-auto max-w-md px-4 pt-6 pb-12">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">ปฏิทินทีม</h1>
        {requestedYm !== todayYm && (
          // "Today" jump — preserves muscle memory after scrubbing months.
          <Link
            href="/liff/calendar"
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            วันนี้
          </Link>
        )}
      </header>

      {/* Month navigator: prev / month-label / next */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <Link
          href={`/liff/calendar?ym=${prevYm}`}
          aria-label="เดือนก่อนหน้า"
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ‹
        </Link>
        <p className="text-sm font-semibold text-gray-900">{monthLabel}</p>
        <Link
          href={`/liff/calendar?ym=${nextYm}`}
          aria-label="เดือนถัดไป"
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ›
        </Link>
      </div>

      <CalendarGrid grid={grid} entries={entries} holidays={holidays} />

      <p className="mt-4 text-center text-[11px] text-gray-400">
        แสดงคำขอลาในสาขาเดียวกับคุณ • รวมที่กำลังรออนุมัติ
      </p>

      <nav className="mt-6 flex justify-center gap-4 text-xs">
        <Link href="/liff/leave" className="text-gray-500 hover:text-gray-700">
          ← คำขอลาของฉัน
        </Link>
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          เช็คอิน
        </Link>
      </nav>
    </main>
  );
}
