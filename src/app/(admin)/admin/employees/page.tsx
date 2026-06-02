import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
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

  type Emp = (typeof employees)[number];
  const noFilters = !q && !branchId && !departmentId && status !== 'archived';

  const columns: Column<Emp>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (e) => (
        <div>
          <div className="font-medium text-ink-1">
            {e.firstName} {e.lastName}
          </div>
          {e.nickname && <div className="text-xs text-ink-3">({e.nickname})</div>}
        </div>
      ),
    },
    { key: 'branch', header: 'สาขา', cell: (e) => e.branch.name },
    { key: 'department', header: 'แผนก', cell: (e) => e.department?.name ?? '—' },
    {
      key: 'salary',
      header: 'เงินเดือน',
      cell: (e) => (
        <span className="tabular">
          {fmtMoney(e.baseSalary)}
          <span className="ml-1 text-xs text-ink-4">/{e.salaryType.toLowerCase()}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      cell: (e) => (
        <StatusBadge status={STATUS_KIND[e.status] ?? 'neutral'}>
          {STATUS_LABEL[e.status] ?? e.status}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="พนักงาน"
        title="พนักงาน"
        subtitle="จัดการบัญชี สิทธิ์ และการมอบหมายสาขาของพนักงานทุกคน"
        actions={
          <Link href="/admin/employees/new">
            <Button>+ เพิ่มพนักงาน</Button>
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

      <div className="mb-4">
        <EmployeeFilters
          initial={{ q, branchId, departmentId, status }}
          branches={branches}
          departments={departments}
          matchedCount={employees.length}
        />
      </div>

      <ResponsiveTable
        columns={columns}
        rows={employees}
        rowKey={(e) => e.id}
        actions={(e) => (
          <Link
            href={`/admin/employees/${e.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title={
                status === 'archived'
                  ? 'ยังไม่มีพนักงานพ้นสภาพ'
                  : q || branchId || departmentId
                    ? 'ไม่พบพนักงานที่ตรงกับตัวกรอง'
                    : 'ยังไม่มีพนักงาน'
              }
              hint={noFilters ? 'เริ่มต้นด้วยการเพิ่มพนักงานคนแรก' : undefined}
              action={
                noFilters ? (
                  <Link href="/admin/employees/new">
                    <Button variant="secondary">+ เพิ่มพนักงานคนแรก</Button>
                  </Link>
                ) : undefined
              }
            />
          </div>
        }
      />
    </div>
  );
}
