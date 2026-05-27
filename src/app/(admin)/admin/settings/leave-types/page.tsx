import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
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
      _count: { select: { requests: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ประเภทการลา</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            กำหนดประเภทการลาที่พนักงานเลือกได้จาก LIFF (ลาป่วย / ลากิจ / ลาพักร้อน ฯลฯ)
          </p>
        </div>
        <Link href="/admin/settings/leave-types/new">
          <Button>+ เพิ่มประเภท</Button>
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
              <p className="text-sm text-gray-500">ยังไม่มีประเภทการลา</p>
              <p className="mt-1 text-xs text-gray-400">
                พนักงานต้องมีประเภทการลาอย่างน้อย 1 รายการก่อนจึงจะส่งคำขอลาได้
              </p>
              <Link href="/admin/settings/leave-types/new" className="mt-3 inline-block">
                <Button variant="secondary">+ เพิ่มประเภทแรก</Button>
              </Link>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>ชื่อ</TH>
                  <TH>การจ่ายเงิน</TH>
                  <TH>โควต้า/ปี</TH>
                  <TH>คำขอทั้งหมด</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium text-gray-900">{t.name}</TD>
                    <TD>
                      {t.isPaid ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          จ่ายเงิน
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          ไม่จ่าย
                        </span>
                      )}
                    </TD>
                    <TD className="tabular-nums text-gray-700">
                      {t.annualQuota != null ? `${t.annualQuota} วัน` : 'ไม่จำกัด'}
                    </TD>
                    <TD className="tabular-nums">{t._count.requests}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/admin/settings/leave-types/${t.id}/edit`}
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
