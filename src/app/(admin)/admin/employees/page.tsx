import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string; status?: string }>;

/** Format Decimal/string baseSalary as ฿X,XXX */
function fmtMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(n);
}

const STATUS_LABEL: Record<string, string> = {
  Probation: 'ทดลองงาน',
  Active: 'ปกติ',
  Archived: 'พ้นสภาพ',
};

const STATUS_KIND: Record<string, StatusKey> = {
  Probation: 'probation',
  Active: 'active',
  Archived: 'archived',
};

export default async function EmployeeListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error, status } = await searchParams;

  // Filter: by default hide Archived; allow ?status=archived to see them
  const showArchived = status === 'archived';
  const employees = await prisma.employee.findMany({
    where: showArchived ? { status: 'Archived' } : { archivedAt: null },
    orderBy: [{ status: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      status: true,
      salaryType: true,
      baseSalary: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">พนักงาน</h1>
        <div className="flex items-center gap-3">
          <Link
            href={showArchived ? '/admin/employees' : '/admin/employees?status=archived'}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            {showArchived ? '← กลับไปดูพนักงานปัจจุบัน' : 'ดูพนักงานพ้นสภาพ →'}
          </Link>
          <Link href="/admin/employees/new">
            <Button>+ เพิ่มพนักงาน</Button>
          </Link>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {showArchived ? 'พ้นสภาพ' : 'ทั้งหมด'}{' '}
            <span className="tabular-nums text-gray-500">({employees.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {employees.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">
                {showArchived ? 'ยังไม่มีพนักงานพ้นสภาพ' : 'ยังไม่มีพนักงาน'}
              </p>
              {!showArchived && (
                <Link href="/admin/employees/new" className="mt-3 inline-block">
                  <Button variant="secondary">+ เพิ่มพนักงานคนแรก</Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>ชื่อ</TH>
                  <TH>สาขา</TH>
                  <TH>แผนก</TH>
                  <TH>เงินเดือน</TH>
                  <TH>สถานะ</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {employees.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <div className="font-medium text-gray-900">
                        {e.firstName} {e.lastName}
                      </div>
                      {e.nickname && <div className="text-xs text-gray-500">({e.nickname})</div>}
                    </TD>
                    <TD>{e.branch.name}</TD>
                    <TD className="text-gray-500">{e.department?.name ?? '—'}</TD>
                    <TD className="tabular-nums">
                      {fmtMoney(e.baseSalary)}
                      <span className="ml-1 text-xs text-gray-400">
                        /{e.salaryType.toLowerCase()}
                      </span>
                    </TD>
                    <TD>
                      <StatusBadge status={STATUS_KIND[e.status] ?? 'neutral'}>
                        {STATUS_LABEL[e.status] ?? e.status}
                      </StatusBadge>
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/employees/${e.id}/edit`}
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
