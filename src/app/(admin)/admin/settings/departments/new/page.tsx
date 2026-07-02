import { PageHeader } from '@/components/ui/page-header';
import { createDepartment } from '../actions';
import { DepartmentForm } from '../department-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewDepartmentPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · แผนก" title="เพิ่มแผนก" />
      <div>
        <DepartmentForm
          mode="create"
          action={createDepartment}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
