import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { createRole } from '../actions';
import { RoleForm } from '../role-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewRolePage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('role.manage');
  const { error } = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · บทบาทและสิทธิ์" title="เพิ่มบทบาท" />
      <div>
        <RoleForm
          mode="create"
          action={createRole}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
