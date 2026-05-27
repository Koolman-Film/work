import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
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
      latitude: true,
      longitude: true,
      attendanceSource: true,
      _count: { select: { employees: { where: { archivedAt: null } } } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">สาขา</h2>
          <p className="mt-0.5 text-sm text-gray-500">ตำแหน่ง + geofence — ใช้กับ LIFF check-in</p>
        </div>
        <Link href="/admin/settings/branches/new">
          <Button>+ เพิ่มสาขา</Button>
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
            ทั้งหมด <span className="tabular-nums text-gray-500">({branches.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {branches.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>ชื่อ</TH>
                  <TH>ที่อยู่</TH>
                  <TH>Geofence</TH>
                  <TH>Selfie</TH>
                  <TH>พนักงาน</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {branches.map((b) => (
                  <TR key={b.id}>
                    <TD className="font-medium text-gray-900">{b.name}</TD>
                    <TD className="max-w-xs truncate text-gray-500">{b.address ?? '—'}</TD>
                    <TD className="tabular-nums">
                      {b.latitude && b.longitude ? `${b.radiusMeters}m` : '— (ยังไม่ตั้งค่า)'}
                    </TD>
                    <TD>{b.requireSelfie ? '✅' : '—'}</TD>
                    <TD className="tabular-nums">{b._count.employees}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/settings/branches/${b.id}/edit`}
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

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm text-gray-500">ยังไม่มีสาขา</p>
      <Link href="/admin/settings/branches/new" className="mt-3 inline-block">
        <Button variant="secondary">+ เพิ่มสาขาแรก</Button>
      </Link>
    </div>
  );
}
