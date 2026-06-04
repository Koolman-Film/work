import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';

/**
 * /admin/settings/holidays — list of company holidays.
 *
 * Sort: by date ascending (chronological from oldest to newest). When the
 * list grows beyond a year or two, we'll add year-tabs; for now flat is
 * fine — Thailand has ~16 official holidays per year, so a 2-year list
 * is ~32 rows, comfortably scannable.
 *
 * The "วัน" column shows day-of-week in Thai — useful for admins to
 * eyeball whether a holiday falls on a Sunday (already excluded by
 * workingDaysIn anyway, so listing it is mostly for clarity) or weekday.
 */

type SearchParams = Promise<{ error?: string }>;

const THAI_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

function formatDate(d: Date): string {
  // Display in Thai locale with Buddhist year.
  return d.toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function dayOfWeekTh(d: Date): string {
  const idx = d.getUTCDay();
  return THAI_DOW[idx] ?? '?';
}

export default async function HolidayListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  // Only non-archived; chronological.
  const rows = await prisma.holiday.findMany({
    where: { archivedAt: null },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, name: true, isSubstitute: true },
  });

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'date',
      header: 'วันที่',
      cell: (h) => <span className="font-mono text-ink-2">{formatDate(h.date)}</span>,
    },
    {
      key: 'dow',
      header: 'วัน',
      cell: (h) => <span className="text-ink-3">{dayOfWeekTh(h.date)}</span>,
    },
    {
      key: 'name',
      header: 'ชื่อวันหยุด',
      cell: (h) => <span className="font-medium text-ink-1">{h.name}</span>,
    },
    {
      key: 'type',
      header: 'ประเภท',
      cell: (h) =>
        h.isSubstitute ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            ชดเชย
          </span>
        ) : (
          <span className="text-xs text-ink-3">—</span>
        ),
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="วันหยุด"
        subtitle="วันหยุดที่ไม่นับเป็นวันลา — ใช้กับการคำนวณวันทำงานในคำขอลา"
        actions={
          <Link href="/admin/settings/holidays/new">
            <Button>+ เพิ่มวันหยุด</Button>
          </Link>
        }
      />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-deep"
        >
          {decodeURIComponent(error)}
        </div>
      )}

      <ResponsiveTable
        columns={columns}
        rows={rows}
        rowKey={(h) => h.id}
        actions={(h) => (
          <Link
            href={`/admin/settings/holidays/${h.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีวันหยุด"
              action={
                <Link href="/admin/settings/holidays/new">
                  <Button variant="secondary">+ เพิ่มวันหยุดแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}
