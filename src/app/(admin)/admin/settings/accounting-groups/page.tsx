import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
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

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">กลุ่มบัญชี</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            แยกพนักงานเป็น 2 กลุ่ม เพื่อ PEAK export — ค่าใช้จ่ายบริษัท / จ่ายแทน-รับคืน
          </p>
        </div>
        <Link href="/admin/settings/accounting-groups/new">
          <Button>+ เพิ่มกลุ่ม</Button>
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
            ทั้งหมด <span className="tabular-nums text-gray-500">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">ยังไม่มีกลุ่มบัญชี</p>
              <Link href="/admin/settings/accounting-groups/new" className="mt-3 inline-block">
                <Button variant="secondary">+ เพิ่มกลุ่มแรก</Button>
              </Link>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>ชื่อ</TH>
                  <TH>PEAK Code</TH>
                  <TH>คำอธิบาย</TH>
                  <TH>พนักงาน</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((g) => (
                  <TR key={g.id}>
                    <TD className="font-medium text-gray-900">{g.name}</TD>
                    <TD className="font-mono text-xs text-gray-700">{g.peakCode ?? '—'}</TD>
                    <TD className="max-w-md truncate text-gray-500">{g.description ?? '—'}</TD>
                    <TD className="tabular-nums">{g._count.employees}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/settings/accounting-groups/${g.id}/edit`}
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
