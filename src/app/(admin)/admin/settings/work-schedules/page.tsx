import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
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

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ตารางงาน</h2>
          <p className="mt-0.5 text-sm text-gray-500">ตั้งวันทำงาน + เวลาเริ่ม-เลิก ต่อวัน</p>
        </div>
        <Link href="/admin/settings/work-schedules/new">
          <Button>+ เพิ่มตาราง</Button>
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-gray-500">({schedules.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {schedules.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>ชื่อ</TH>
                  <TH>วันทำงาน</TH>
                  <TH>เวลายืดหยุ่น</TH>
                  <TH>พนักงาน</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {schedules.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-gray-900">{s.name}</TD>
                    <TD>
                      <DaySummary days={s.days} />
                    </TD>
                    <TD className="tabular-nums text-gray-500">{s.lateToleranceMin} นาที</TD>
                    <TD className="tabular-nums">{s._count.employees}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/settings/work-schedules/${s.id}/edit`}
                        className="text-sm font-medium text-primary-600 hover:text-primary-700"
                      >
                        แก้ไข
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
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

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm text-gray-500">ยังไม่มีตารางงาน</p>
      <Link href="/admin/settings/work-schedules/new" className="mt-3 inline-block">
        <Button variant="secondary">+ สร้างตารางแรก</Button>
      </Link>
    </div>
  );
}
