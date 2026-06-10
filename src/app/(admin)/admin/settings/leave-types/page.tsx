import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

export default async function LeaveTypeListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  const rows = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      isPaid: true,
      annualQuota: true,
      overQuotaPolicy: true,
      _count: { select: { requests: true } },
    },
  });

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (t) => <span className="font-medium text-ink-1">{t.name}</span>,
    },
    {
      key: 'isPaid',
      header: 'การจ่ายเงิน',
      cell: (t) =>
        t.isPaid ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            จ่ายเงิน
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            ไม่จ่าย
          </span>
        ),
    },
    {
      key: 'annualQuota',
      header: 'โควต้า/ปี',
      cell: (t) =>
        t.annualQuota != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular-nums text-ink-2">{t.annualQuota} วัน</span>
            {t.overQuotaPolicy === 'Block' ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                บล็อก
              </span>
            ) : (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                หักเงิน
              </span>
            )}
          </span>
        ) : (
          <span className="tabular-nums text-ink-2">ไม่จำกัด</span>
        ),
    },
    {
      key: 'requests',
      header: 'คำขอทั้งหมด',
      cell: (t) => <span className="tabular-nums text-ink-2">{t._count.requests}</span>,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ประเภทการลา"
        subtitle="กำหนดประเภทการลาที่พนักงานเลือกได้จาก LIFF (ลาป่วย / ลากิจ / ลาพักร้อน ฯลฯ)"
        actions={
          <Link href="/admin/settings/leave-types/new">
            <Button>+ เพิ่มประเภท</Button>
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
        rowKey={(t) => t.id}
        actions={(t) => (
          <Link
            href={`/admin/settings/leave-types/${t.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีประเภทการลา"
              action={
                <Link href="/admin/settings/leave-types/new">
                  <Button variant="secondary">+ เพิ่มประเภทแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}
