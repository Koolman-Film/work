import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { prisma } from '@/lib/db/prisma';
import { EmployeeFilters } from './employee-filters';

/**
 * Employee list with URL-driven filters: search (q), branch, department,
 * status. Default view shows non-archived employees; explicit
 * ?status=archived surfaces pasted-sphere employees.
 *
 * All filters compose — `?q=ตงค์&branchId=...&status=active` returns the
 * intersection. The where-clause builder below collects them into a
 * single Prisma WhereInput so the DB does the work.
 */

type SearchParams = Promise<{
  error?: string;
  q?: string;
  branchId?: string;
  departmentId?: string;
  status?: string;
}>;

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

/**
 * Translate the `status` URL param to a Prisma where clause fragment.
 *
 *   ''         → default: archivedAt: null (non-archived; mixed Active +
 *                                            Probation)
 *   'active'   → status: 'Active'
 *   'probation'→ status: 'Probation'
 *   'archived' → status: 'Archived'
 */
function statusWhere(status: string): Prisma.EmployeeWhereInput {
  if (status === 'archived') return { status: 'Archived' };
  if (status === 'active') return { status: 'Active' };
  if (status === 'probation') return { status: 'Probation' };
  return { archivedAt: null };
}

export default async function EmployeeListPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const error = sp.error;
  const q = sp.q?.trim() ?? '';
  const branchId = sp.branchId ?? '';
  const departmentId = sp.departmentId ?? '';
  const status = sp.status ?? '';

  // Compose the Prisma where clause from all active filters. The base is
  // the status filter (which sets either status= or archivedAt=null);
  // then we layer branch, department, and search on top.
  const where: Prisma.EmployeeWhereInput = { ...statusWhere(status) };
  if (branchId) where.branchId = branchId;
  if (departmentId) where.departmentId = departmentId;
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { nickname: { contains: q, mode: 'insensitive' } },
    ];
  }

  // Single round-trip for the data + the dropdown options.
  const [employees, branches, departments] = await Promise.all([
    prisma.employee.findMany({
      where,
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
    }),
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">พนักงาน</h1>
        <Link href="/admin/employees/new">
          <Button>+ เพิ่มพนักงาน</Button>
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <EmployeeFilters
        initial={{ q, branchId, departmentId, status }}
        branches={branches}
        departments={departments}
        matchedCount={employees.length}
      />

      <Card>
        <CardBody className="!p-0">
          {employees.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">
                {status === 'archived'
                  ? 'ยังไม่มีพนักงานพ้นสภาพ'
                  : q || branchId || departmentId
                    ? 'ไม่พบพนักงานที่ตรงกับตัวกรอง'
                    : 'ยังไม่มีพนักงาน'}
              </p>
              {!q && !branchId && !departmentId && status !== 'archived' && (
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
