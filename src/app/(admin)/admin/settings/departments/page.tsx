import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

export default async function DepartmentListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  const rows = await prisma.department.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { employees: { where: { archivedAt: null } } } },
    },
  });

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (d) => <span className="font-medium text-ink-1">{d.name}</span>,
    },
    {
      key: 'desc',
      header: 'คำอธิบาย',
      cell: (d) => <span className="text-ink-3">{d.description ?? '—'}</span>,
    },
    {
      key: 'employees',
      header: 'พนักงาน',
      cell: (d) => <span className="tabular-nums text-ink-2">{d._count.employees}</span>,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="แผนก"
        subtitle="จัดกลุ่มพนักงานตามหน้าที่"
        actions={
          <Link href="/admin/settings/departments/new">
            <Button>+ เพิ่มแผนก</Button>
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
        rowKey={(d) => d.id}
        actions={(d) => (
          <Link
            href={`/admin/settings/departments/${d.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีแผนก"
              action={
                <Link href="/admin/settings/departments/new">
                  <Button variant="secondary">+ เพิ่มแผนกแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}
