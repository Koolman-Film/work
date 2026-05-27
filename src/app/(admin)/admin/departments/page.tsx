import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">แผนก</h1>
        <Link href="/admin/departments/new">
          <Button>+ เพิ่มแผนก</Button>
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
              <p className="text-sm text-gray-500">ยังไม่มีแผนก</p>
              <Link href="/admin/departments/new" className="mt-3 inline-block">
                <Button variant="secondary">+ เพิ่มแผนกแรก</Button>
              </Link>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>ชื่อ</TH>
                  <TH>คำอธิบาย</TH>
                  <TH>พนักงาน</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-medium text-gray-900">{d.name}</TD>
                    <TD className="max-w-md truncate text-gray-500">{d.description ?? '—'}</TD>
                    <TD className="tabular-nums">{d._count.employees}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/departments/${d.id}/edit`}
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
