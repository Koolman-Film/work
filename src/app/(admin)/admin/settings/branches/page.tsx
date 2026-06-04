import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

export default async function BranchListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  const branches = await prisma.branch.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      address: true,
      radiusMeters: true,
      requireSelfie: true,
      requireGps: true,
      requireCheckOut: true,
      latitude: true,
      longitude: true,
      attendanceSource: true,
      _count: { select: { employees: { where: { archivedAt: null } } } },
    },
  });

  const columns: Column<(typeof branches)[number]>[] = [
    {
      key: 'name',
      header: 'ชื่อ',
      cell: (b) => <span className="font-medium text-ink-1">{b.name}</span>,
    },
    {
      key: 'address',
      header: 'ที่อยู่',
      cell: (b) => <span className="text-ink-3">{b.address ?? '—'}</span>,
    },
    {
      key: 'geofence',
      header: 'Geofence',
      cell: (b) => (
        <span className="tabular-nums text-ink-2">
          {b.latitude && b.longitude ? `${b.radiusMeters}m` : '— (ยังไม่ตั้งค่า)'}
        </span>
      ),
    },
    {
      key: 'gps',
      header: 'GPS',
      cell: (b) => <span>{b.requireGps ? '✅' : '—'}</span>,
    },
    {
      key: 'selfie',
      header: 'Selfie',
      cell: (b) => <span>{b.requireSelfie ? '✅' : '—'}</span>,
    },
    {
      key: 'checkout',
      header: 'เช็คเอาท์',
      cell: (b) => <span>{b.requireCheckOut ? '✅' : '—'}</span>,
    },
    {
      key: 'employees',
      header: 'พนักงาน',
      cell: (b) => <span className="tabular-nums text-ink-2">{b._count.employees}</span>,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="สาขา"
        subtitle="ตำแหน่ง + geofence — ใช้กับ LIFF check-in"
        actions={
          <Link href="/admin/settings/branches/new">
            <Button>+ เพิ่มสาขา</Button>
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
        rows={branches}
        rowKey={(b) => b.id}
        actions={(b) => (
          <Link
            href={`/admin/settings/branches/${b.id}/edit`}
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            แก้ไข
          </Link>
        )}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีสาขา"
              action={
                <Link href="/admin/settings/branches/new">
                  <Button variant="secondary">+ เพิ่มสาขาแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />
    </div>
  );
}
