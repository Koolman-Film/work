import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { requirePermission } from '@/lib/auth/check-permission';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ error?: string; notice?: string }>;

export default async function TeamListPage({ searchParams }: { searchParams: SearchParams }) {
  // Admin holds team.read so they can SEE the team list (helpful for
  // "who can I escalate to?"). Write actions below all gate on
  // team.create / team.update / team.delete which Admin doesn't hold,
  // so the edit/+เพิ่ม buttons become read-only signals.
  // tier is computed from assignments by requirePermission. We use it
  // for the per-row canEdit check below.
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

  const columns: Column<Member>[] = [
    {
      key: 'email',
      header: 'อีเมล',
      cell: (m) => (
        <span className="font-medium text-ink-1">
          {m.email ?? '—'}
          {m.id === actor.id && (
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              คุณ
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'บทบาท',
      cell: (m) => <RoleBadge role={m.tier} />,
    },
    {
      key: 'createdAt',
      header: 'สร้างเมื่อ',
      cell: (m) => (
        <span className="tabular-nums text-ink-3">
          {m.createdAt.toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ทีมผู้ดูแล"
        subtitle="บัญชี Admin / Superadmin ที่เข้าใช้แผงควบคุมได้"
        actions={
          <Link href="/admin/settings/team/new">
            <Button>+ เพิ่มผู้ดูแล</Button>
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
      {notice && (
        <div className="mb-4 rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep">
          {decodeURIComponent(notice)}
        </div>
      )}

      <ResponsiveTable
        columns={columns}
        rows={members}
        rowKey={(m) => m.id}
        actions={(m) => {
          // Admin actor cannot edit Superadmin — server enforces; we
          // gray the link out so the UI doesn't promise something
          // that won't work. tier is computed per-row from the
          // member's role assignments (Phase 4).
          const canEdit = actorTier === 'Superadmin' || m.tier === 'Admin';
          return canEdit ? (
            <Link
              href={`/admin/settings/team/${m.id}/edit`}
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              แก้ไข
            </Link>
          ) : (
            <span className="text-sm text-ink-4" title="ต้องเป็น Superadmin">
              อ่านอย่างเดียว
            </span>
          );
        }}
        empty={
          <div className="surface">
            <EmptyState
              title="ยังไม่มีผู้ดูแล"
              action={
                <Link href="/admin/settings/team/new">
                  <Button variant="secondary">+ เพิ่มผู้ดูแลคนแรก</Button>
                </Link>
              }
            />
          </div>
        }
      />

      <p className="mt-3 text-xs text-ink-3">
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
