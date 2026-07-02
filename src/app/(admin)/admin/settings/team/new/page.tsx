import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { createTeamMember } from '../actions';
import { TeamCreateForm } from '../team-form';

type SearchParams = Promise<{ error?: string; email?: string }>;

export default async function NewTeamMemberPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('team.create');
  const { error, email } = await searchParams;

  const [roles, branches] = await Promise.all([
    prisma.roleDefinition.findMany({
      where: { archivedAt: null },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isSuperadmin: true, isSystem: true },
    }),
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · ทีมผู้ดูแล" title="เพิ่มผู้ดูแล" />
      <div>
        <TeamCreateForm
          action={createTeamMember}
          error={error ? decodeURIComponent(error) : null}
          email={email ? decodeURIComponent(email) : null}
          roles={roles}
          branches={branches}
        />
      </div>
    </div>
  );
}
