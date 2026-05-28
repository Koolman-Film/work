import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/check-permission';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string; notice?: string }>;

export default async function TeamListPage({ searchParams }: { searchParams: SearchParams }) {
  // Admin holds team.read so they can SEE the team list (helpful for
  // "who can I escalate to?"). Write actions below all gate on
  // team.create / team.update / team.delete which Admin doesn't hold,
  // so the edit/+เพิ่ม buttons become read-only signals.
  // tier is computed from assignments by requireRole / requirePermission
  // (Phase 4). We use it for the per-row canEdit check below.
  const { user: actor, tier: actorTier } = await requirePermission('team.read');
  const { error, notice } = await searchParams;

  // Phase 4: query "users with at least one active admin-tier role
  // assignment" — i.e. anyone who'd land in /admin. Pre-Phase 4 this
  // was `where: { role: { in: ['Admin', 'Superadmin'] } }` against
  // the legacy column.
  const rawMembers = await prisma.user.findMany({
    where: {
      archivedAt: null,
      roleAssignments: {
        some: {
          role: {
            archivedAt: null,
            OR: [{ isSuperadmin: true }, { key: 'admin' }],
          },
        },
      },
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      roleAssignments: {
        select: {
          role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
        },
      },
    },
  });

  // Compute tier per row + sort. Old sort was `role asc, email asc`
  // which interleaved Admins then Superadmins; the tier comparator
  // here preserves that intent (Admin < Superadmin alphabetically →
  // same ordering). Falls back to email asc within a tier.
  type Member = { id: string; email: string | null; createdAt: Date; tier: 'Admin' | 'Superadmin' };
  const members: Member[] = rawMembers
    .map((m) => {
      const t = computeTier(m.roleAssignments);
      // We queried for admin-tier users; tier should never be null or
      // Staff for these rows. Defensive coercion.
      return t === 'Admin' || t === 'Superadmin'
        ? { id: m.id, email: m.email, createdAt: m.createdAt, tier: t }
        : null;
    })
    .filter((m): m is Member => m !== null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier < b.tier ? -1 : 1;
      return (a.email ?? '').localeCompare(b.email ?? '');
    });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ทีมผู้ดูแล</h2>
          <p className="mt-0.5 text-sm text-gray-500">บัญชี Admin / Superadmin ที่เข้าใช้แผงควบคุมได้</p>
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
                  // Admin actor cannot edit Superadmin — server enforces; we
                  // gray the link out so the UI doesn't promise something
                  // that won't work. tier is computed per-row from the
                  // member's role assignments (Phase 4).
                  const canEdit = actorTier === 'Superadmin' || m.tier === 'Admin';
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
                        <RoleBadge role={m.tier} />
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
                          <span className="text-sm text-gray-400" title="ต้องเป็น Superadmin">
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
        บัญชีที่ระงับแล้ว (archive) จะถูกซ่อนจากรายการนี้ — ติดต่อ Superadmin เพื่อกู้คืน
      </p>
    </div>
  );
}

function RoleBadge({ role }: { role: 'Admin' | 'Superadmin' }) {
  if (role === 'Superadmin') {
    return (
      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
        Superadmin
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
