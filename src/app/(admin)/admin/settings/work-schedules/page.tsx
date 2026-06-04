import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

const DAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']; // index = dayOfWeek (0=Sun)

export default async function WorkScheduleListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;

  const schedules = await prisma.workSchedule.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    include: {
      days: { orderBy: { dayOfWeek: 'asc' } },
      _count: { select: { employees: { where: { archivedAt: null } } } },
    },
  });

  const columns: Column<(typeof schedules)[number]>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (s) => <span className="font-medium text-ink-1">{s.name}</span>,
    },
    {
      key: 'days',
      header: 'วันทำงาน',
      cell: (s) => <DaySummary days={s.days} />,
    },
    {
      key: 'lateTolerance',
      header: 'เวลายืดหยุ่น',
      cell: (s) => <span className="tabular-nums text-ink-3">{s.lateToleranceMin} นาที</span>,
    },
    {
      key: 'employees',
      header: 'พนักงาน',
      cell: (s) => <span className="tabular-nums text-ink-2">{s._count.employees}</span>,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ตารางงาน"
        subtitle="ตั้งวันทำงาน + เวลาเริ่ม-เลิก ต่อวัน"
        actions={
          <Link href="/admin/settings/work-schedules/new">
            <Button>+ เพิ่มตาราง</Button>
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
        rows={schedules}
        rowKey={(s) => s.id}
        actions={(s) => (
          <Link
            href={`/admin/settings/work-schedules/${s.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีตารางงาน"
              action={
                <Link href="/admin/settings/work-schedules/new">
                  <Button variant="secondary">+ สร้างตารางแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}

/**
 * Compact summary of enabled days. If all 7 day rows share the same
 * start/end time, render once ("จ.-ส. 09:00-18:00"). Otherwise render
 * the day chips only — clicking through to /edit shows the per-day
 * detail. Designed to fit on one row of the list table.
 */
function DaySummary({
  days,
}: {
  days: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
}) {
  if (days.length === 0) {
    return <span className="text-xs text-gray-400">ไม่มีวันทำงาน</span>;
  }

  // Check if all days have identical times (the common case).
  const firstStart = days[0]?.startTime;
  const firstEnd = days[0]?.endTime;
  const uniform =
    firstStart != null &&
    firstEnd != null &&
    days.every((d) => d.startTime === firstStart && d.endTime === firstEnd);

  const chips = days.map((d) => DAY_SHORT[d.dayOfWeek] ?? '?').join(' ');

  if (uniform) {
    return (
      <span className="text-sm text-gray-700">
        <span className="font-medium">{chips}</span>{' '}
        <span className="tabular-nums text-gray-500">
          {firstStart}-{firstEnd}
        </span>
      </span>
    );
  }

  return (
    <span className="text-sm text-gray-700">
      <span className="font-medium">{chips}</span>{' '}
      <span className="text-xs text-gray-500">(เวลาต่างกันต่อวัน)</span>
    </span>
  );
}
