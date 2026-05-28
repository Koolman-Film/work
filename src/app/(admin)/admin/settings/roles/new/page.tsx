import { requirePermission } from '@/lib/auth/check-permission';
import { createRole } from '../actions';
import { RoleForm } from '../role-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewRolePage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('role.manage');
  const { error } = await searchParams;

  return (
    <div className="max-w-3xl">
      <RoleForm
        mode="create"
        action={createRole}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
