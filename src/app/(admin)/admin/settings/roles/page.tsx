import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/check-permission';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string }>;

export default async function RoleListPage({ searchParams }: { searchParams: SearchParams }) {
  // role.read is in every Admin's default perm list — Superadmin
  // gets it via the isSuperadmin shortcut. Page is view-only; the
  // edit/new pages and the actions gate on role.manage (Superadmin only).
  await requirePermission('role.read');
  const { error } = await searchParams;

  const totalPermCount = Object.keys(PERMISSIONS).length;

  const roles = await prisma.roleDefinition.findMany({
    where: { archivedAt: null },
    orderBy: [
      { isSystem: 'desc' }, // system roles first
      { name: 'asc' },
    ],
    include: {
      _count: { select: { assignments: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">บทบาทและสิทธิ์</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            จัดการบทบาทระบบ + สร้างบทบาทกำหนดเองสำหรับผู้ดูแลและพนักงาน
          </p>
        </div>
        <Link href="/admin/settings/roles/new">
          <Button>+ เพิ่มบทบาท</Button>
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
            ทั้งหมด <span className="tabular-nums text-gray-500">({roles.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          <Table>
            <THead>
              <TR>
                <TH>ชื่อ</TH>
                <TH>คำอธิบาย</TH>
                <TH>สิทธิ์</TH>
                <TH>ผู้ใช้</TH>
                <TH>ประเภท</TH>
                <TH className="text-right">การจัดการ</TH>
              </TR>
            </THead>
            <TBody>
              {roles.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium text-gray-900">
                    {r.name}
                    <code className="ml-2 rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">
                      {r.key}
                    </code>
                  </TD>
                  <TD className="max-w-xs text-xs text-gray-500">
                    <span className="line-clamp-2">{r.description ?? '—'}</span>
                  </TD>
                  <TD className="tabular-nums text-sm">
                    {r.isSuperadmin ? (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                        ทั้งหมด ({totalPermCount})
                      </span>
                    ) : (
                      <span>
                        {r.permissions.length} / {totalPermCount}
                      </span>
                    )}
                  </TD>
                  <TD className="tabular-nums">{r._count.assignments}</TD>
                  <TD>
                    {r.isSystem ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        ระบบ
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        กำหนดเอง
                      </span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <Link
                      href={`/admin/settings/roles/${r.id}/edit`}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      แก้ไข
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <p className="mt-3 text-xs text-gray-500">
        บทบาทระบบ (Superadmin / Admin / Staff) มาพร้อมระบบ — แก้ชื่อ + รายการสิทธิ์ได้ แต่ลบไม่ได้
        ส่วนบทบาทกำหนดเองลบได้เมื่อไม่มีผู้ใช้ที่ได้รับมอบหมาย
      </p>
    </div>
  );
}
