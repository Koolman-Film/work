import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string; notice?: string }>;

export default async function TeamListPage({ searchParams }: { searchParams: SearchParams }) {
  // Both roles can land here — but the table & buttons adapt to what
  // the actor is allowed to do. Admin sees Owners as read-only.
  const { user: actor } = await requireRole(['Admin', 'Superadmin']);
  const { error, notice } = await searchParams;

  const members = await prisma.user.findMany({
    where: {
      role: { in: ['Admin', 'Superadmin'] },
      archivedAt: null,
    },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ทีมผู้ดูแล</h2>
          <p className="mt-0.5 text-sm text-gray-500">บัญชี Admin / Owner ที่เข้าใช้แผงควบคุมได้</p>
        </div>
        <Link href="/admin/settings/team/new">
          <Button>+ เพิ่มผู้ดูแล</Button>
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          {decodeURIComponent(notice)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-gray-500">({members.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {members.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>อีเมล</TH>
                  <TH>บทบาท</TH>
                  <TH>สร้างเมื่อ</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((m) => {
                  // Admin actor cannot edit Owner — server enforces; we
                  // gray the link out so the UI doesn't promise something
                  // that won't work.
                  const canEdit = actor.role === 'Superadmin' || m.role === 'Admin';
                  const isSelf = m.id === actor.id;

                  return (
                    <TR key={m.id}>
                      <TD className="font-medium text-gray-900">
                        {m.email ?? '—'}
                        {isSelf && (
                          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                            คุณ
                          </span>
                        )}
                      </TD>
                      <TD>
                        <RoleBadge role={m.role as 'Admin' | 'Superadmin'} />
                      </TD>
                      <TD className="tabular-nums text-gray-500">
                        {m.createdAt.toLocaleDateString('th-TH', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </TD>
                      <TD className="text-right">
                        {canEdit ? (
                          <Link
                            href={`/admin/settings/team/${m.id}/edit`}
                            className="text-sm font-medium text-primary-600 hover:text-primary-700"
                          >
                            แก้ไข
                          </Link>
                        ) : (
                          <span className="text-sm text-gray-400" title="ต้องเป็น Owner">
                            อ่านอย่างเดียว
                          </span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="mt-3 text-xs text-gray-500">
        บัญชีที่ระงับแล้ว (archive) จะถูกซ่อนจากรายการนี้ — ติดต่อ Owner เพื่อกู้คืน
      </p>
    </div>
  );
}

function RoleBadge({ role }: { role: 'Admin' | 'Superadmin' }) {
  if (role === 'Superadmin') {
    return (
      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
        Owner
      </span>
    );
  }
  return (
    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
      Admin
    </span>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm text-gray-500">ยังไม่มีผู้ดูแล</p>
      <Link href="/admin/settings/team/new" className="mt-3 inline-block">
        <Button variant="secondary">+ เพิ่มผู้ดูแลคนแรก</Button>
      </Link>
    </div>
  );
}
