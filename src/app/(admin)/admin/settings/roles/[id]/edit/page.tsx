import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { archiveRole, updateRole } from '../../actions';
import { RoleForm } from '../../role-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditRolePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireRole(['Superadmin']);
  const { id } = await params;
  const { error } = await searchParams;

  const role = await prisma.roleDefinition.findUnique({
    where: { id },
    include: { _count: { select: { assignments: true } } },
  });
  if (!role || role.archivedAt) notFound();

  const updateBound = updateRole.bind(null, id);
  const archiveBound = archiveRole.bind(null, id);

  return (
    <div className="max-w-3xl">
      <RoleForm
        mode="edit"
        action={updateBound}
        initial={{
          key: role.key,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          isSystem: role.isSystem,
          isSuperadmin: role.isSuperadmin,
        }}
        error={error ? decodeURIComponent(error) : null}
        extraActions={
          // System roles can never be archived — hide the button entirely
          // rather than rendering it disabled. Less visual noise.
          role.isSystem ? (
            <p className="text-xs text-gray-500">บทบาทระบบไม่สามารถลบได้ — มีไว้เป็นค่าตั้งต้น</p>
          ) : role._count.assignments > 0 ? (
            <p className="text-xs text-gray-500">
              ลบไม่ได้ — มีผู้ใช้ {role._count.assignments} รายการ ใช้บทบาทนี้อยู่
            </p>
          ) : (
            <form action={archiveBound}>
              <Button type="submit" variant="destructive">
                ลบถาวร
              </Button>
            </form>
          )
        }
      />
    </div>
  );
}
