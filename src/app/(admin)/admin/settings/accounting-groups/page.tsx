import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

export default async function AccountingGroupListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;

  const rows = await prisma.accountingGroup.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      peakCode: true,
      description: true,
      _count: { select: { employees: { where: { archivedAt: null } } } },
    },
  });

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (g) => <span className="font-medium text-ink-1">{g.name}</span>,
    },
    {
      key: 'peakCode',
      header: 'PEAK Code',
      cell: (g) => <span className="font-mono text-xs text-ink-2">{g.peakCode ?? '—'}</span>,
    },
    {
      key: 'desc',
      header: 'คำอธิบาย',
      cell: (g) => <span className="text-ink-3">{g.description ?? '—'}</span>,
    },
    {
      key: 'employees',
      header: 'พนักงาน',
      cell: (g) => <span className="tabular-nums text-ink-2">{g._count.employees}</span>,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="กลุ่มบัญชี"
        subtitle="แยกพนักงานเป็น 2 กลุ่ม เพื่อ PEAK export — ค่าใช้จ่ายบริษัท / จ่ายแทน-รับคืน"
        actions={
          <Link href="/admin/settings/accounting-groups/new">
            <Button>+ เพิ่มกลุ่ม</Button>
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
        rowKey={(g) => g.id}
        actions={(g) => (
          <Link
            href={`/admin/settings/accounting-groups/${g.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีกลุ่มบัญชี"
              action={
                <Link href="/admin/settings/accounting-groups/new">
                  <Button variant="secondary">+ เพิ่มกลุ่มแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}
